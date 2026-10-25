import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalLlmHubPlugin } from "../plugin";
import { ActivityLog, MAX_ACTIVITY_EVENTS, trimActivity, type ActivityEvent } from "./activityLog";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Mabel activity log", () => {
  it("keeps a bounded, chronological event stream", () => {
    const events = Array.from({ length: 650 }, (_, index): ActivityEvent => ({
      id: String(index), runId: "run-a", source: "scheduler",
      kind: "tool-success", title: "read_note", timestamp: index,
    }));
    const kept = trimActivity(events);
    expect(kept).toHaveLength(MAX_ACTIVITY_EVENTS);
    expect(kept[0].id).toBe("50");
    expect(kept[kept.length - 1].id).toBe("649");
  });

  it("streams immediately to UI and persists bursts with one debounced save", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn();
    const plugin = {
      settings: { activityEvents: [] as ActivityEvent[] },
      settingsEmitter: { emit },
      saveSettings,
    } as unknown as LocalLlmHubPlugin;

    const log = new ActivityLog(plugin);
    log.record({ runId: "abc", source: "scheduler", kind: "run-start", title: "Nightly report" });
    log.record({ runId: "abc", source: "scheduler", kind: "tool-start", title: "read_note", path: "Mabel/Memory/User.md" });
    expect(log.list().map(e => e.kind)).toEqual(["tool-start", "run-start"]);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("mabel-activity-changed");

    await vi.advanceTimersByTimeAsync(450);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(plugin.settings.activityEvents).toHaveLength(2);
    expect(plugin.settings.activityEvents[1].path).toBe("Mabel/Memory/User.md");
  });

  it("truncates oversized titles and details", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const plugin = {
      settings: { activityEvents: [] },
      settingsEmitter: { emit: vi.fn() },
      saveSettings: vi.fn().mockResolvedValue(undefined),
    } as unknown as LocalLlmHubPlugin;
    const log = new ActivityLog(plugin);
    const event = log.record({ runId: "a", source: "sleep", kind: "run-error", title: "x".repeat(400), detail: "y".repeat(900) });
    expect(event.title).toHaveLength(150);
    expect(event.detail).toHaveLength(400);
    await log.flush();
  });
});

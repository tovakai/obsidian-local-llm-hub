import { describe, expect, it } from "vitest";
import { nextOccurrence, validateTask, type TaskDraft } from "./scheduler";

const base: TaskDraft = {
  title: "Evening recap",
  prompt: "Summarize the day's events.",
  kind: "prompt",
  repeat: "daily",
  intervalMinutes: 60,
  startsAt: new Date(2026, 9, 24, 20, 30).getTime(),
};

describe("Mabel scheduler time calculations", () => {
  it("preserves local wall time for daily recurrence", () => {
    const after = new Date(2026, 9, 25, 21, 0).getTime();
    const next = new Date(nextOccurrence(base, after)!);
    expect([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()])
      .toEqual([2026, 9, 26, 20, 30]);
  });

  it("preserves the weekday and hour for weekly recurrence", () => {
    const task = { ...base, repeat: "weekly" as const };
    const after = new Date(2026, 10, 10, 12, 0).getTime();
    const next = new Date(nextOccurrence(task, after)!);
    expect([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()])
      .toEqual([2026, 10, 14, 20, 30]);
  });

  it("skips missed interval ticks rather than replaying them", () => {
    const task = { ...base, repeat: "interval" as const, intervalMinutes: 45 };
    const after = base.startsAt + 60 * 60_000;
    expect(nextOccurrence(task, after)).toBe(base.startsAt + 90 * 60_000);
  });

  it("has no next occurrence for a one-shot task", () => {
    expect(nextOccurrence({ ...base, repeat: "once" }, Date.now())).toBeNull();
  });

  it("rejects invalid or unsafe drafts", () => {
    expect(() => validateTask({ ...base, title: " " })).toThrow("title");
    expect(() => validateTask({ ...base, prompt: "" })).toThrow("prompt");
    expect(() => validateTask({ ...base, repeat: "interval", intervalMinutes: 5 })).toThrow("Interval");
    expect(() => validateTask({ ...base, startsAt: Number.NaN })).toThrow("date");
  });

  it("strips extraneous whitespace from the task name and prompt", () => {
    expect(validateTask({ ...base, title: " Hi ", prompt: " Hello " }))
      .toMatchObject({ title: "Hi", prompt: "Hello" });
  });
});

/**
 * Small, bounded activity journal for the Mabel sidebar.
 * No prompts, tool argument bodies, credentials or model transcripts are stored.
 * Full task results continue to live in their existing vault run reports.
 */
import { randomUUID } from "node:crypto";
import type { LocalLlmHubPlugin } from "../plugin";

export type ActivityKind =
  | "run-start" | "run-complete" | "run-error"
  | "tool-start" | "tool-success" | "tool-error"
  | "memory-scan" | "memory-change" | "memory-preview"
  | "memory-backup" | "memory-report";

export type ActivitySource = "scheduler" | "sleep";

export interface ActivityEvent {
  id: string;
  runId: string;
  timestamp: number;
  source: ActivitySource;
  kind: ActivityKind;
  title: string;
  detail?: string;
  taskId?: string;
  path?: string;
}

export type ActivityInput = Omit<ActivityEvent, "id" | "timestamp">;
export const MAX_ACTIVITY_EVENTS = 600;

export function trimActivity(events: ActivityEvent[]): ActivityEvent[] {
  return events.slice(-MAX_ACTIVITY_EVENTS);
}

export class ActivityLog {
  private saveTimer: number | null = null;
  private saving: Promise<void> = Promise.resolve();
  constructor(private plugin: LocalLlmHubPlugin) {}

  list(): ActivityEvent[] {
    return [...(this.plugin.settings.activityEvents || [])].reverse();
  }

  record(event: ActivityInput): ActivityEvent {
    const entry: ActivityEvent = {
      ...event,
      id: randomUUID(),
      timestamp: Date.now(),
      title: event.title.slice(0, 150),
      detail: event.detail?.slice(0, 400),
      path: event.path?.slice(0, 500),
    };
    this.plugin.settings.activityEvents = trimActivity([
      ...(this.plugin.settings.activityEvents || []),
      entry,
    ]);
    this.plugin.settingsEmitter.emit("mabel-activity-changed");
    if (this.saveTimer === null) {
      // Debounce bursts of tool events rather than serializing all plugin
      // settings on every single LLM tool invocation.
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = null;
        void this.flush().catch(error => console.error("[Mabel activity] Save failed:", error));
      }, 400);
    }
    return entry;
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const saving = this.saving.catch(() => undefined).then(() => this.plugin.saveSettings());
    this.saving = saving;
    await saving;
  }

  stop(): void {
    if (this.saveTimer !== null) void this.flush().catch(error => console.error("[Mabel activity] Final save failed:", error));
  }
}

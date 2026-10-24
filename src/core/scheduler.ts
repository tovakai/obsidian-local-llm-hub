import { Notice } from "obsidian";
import { randomUUID } from "node:crypto";
import type { LocalLlmHubPlugin } from "../plugin";
import { runScheduledAgent, type ScheduledToolAudit } from "./scheduledAgent";

export type ScheduleKind = "reminder" | "prompt";
export type ScheduleRepeat = "once" | "daily" | "weekly" | "interval";
export type ScheduleStatus = "running" | "success" | "failed";

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  kind: ScheduleKind;
  repeat: ScheduleRepeat;
  /** Minutes, for interval tasks only. Minimum 15 minutes. */
  intervalMinutes: number;
  /** Explicit permission for unattended vault read/write tools. Defaults to false. */
  allowTools?: boolean;
  /** Separately allow connected MCP tools (which may execute commands). Defaults to false. */
  allowMcpTools?: boolean;
  /** Original local-wall-clock anchor, stored as a Unix millisecond timestamp. */
  startsAt: number;
  nextRunAt: number | null;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastStatus?: ScheduleStatus;
  lastResultPath?: string;
  lastError?: string;
}

export type TaskDraft = Pick<ScheduledTask, "title" | "prompt" | "kind" | "repeat" | "intervalMinutes" | "startsAt" | "allowTools" | "allowMcpTools">;

/**
 * Find the next occurrence strictly AFTER the supplied instant.
 * Daily/weekly repetitions use calendar dates, not 24h/168h elapsed offsets;
 * this preserves the user's local time across daylight saving transitions.
 */
export function nextOccurrence(task: Pick<ScheduledTask, "startsAt" | "repeat" | "intervalMinutes">, after: number): number | null {
  if (task.repeat === "once") return null;
  if (task.repeat === "interval") {
    const step = Math.max(15, Math.floor(task.intervalMinutes)) * 60_000;
    if (task.startsAt > after) return task.startsAt;
    return task.startsAt + (Math.floor((after - task.startsAt) / step) + 1) * step;
  }

  const stepDays = task.repeat === "weekly" ? 7 : 1;
  const origin = new Date(task.startsAt);
  const current = new Date(after);
  const startDay = Date.UTC(origin.getFullYear(), origin.getMonth(), origin.getDate());
  const currentDay = Date.UTC(current.getFullYear(), current.getMonth(), current.getDate());
  const elapsedDays = Math.max(0, Math.floor((currentDay - startDay) / 86_400_000));
  let iteration = Math.max(0, Math.floor(elapsedDays / stepDays) - 1);
  // Reconstruct each candidate from the original time, so a DST gap does not
  // permanently shift the hour of the next day's/next week's occurrence.
  for (;;) {
    const candidate = new Date(origin.getTime());
    candidate.setDate(origin.getDate() + iteration * stepDays);
    if (candidate.getTime() > after) return candidate.getTime();
    iteration++;
  }
}

export function validateTask(draft: TaskDraft): TaskDraft {
  const title = draft.title.trim();
  const prompt = draft.prompt.trim();
  if (!title || title.length > 120) throw new Error("Give the task a title (up to 120 characters).");
  if (!prompt || prompt.length > 15_000) throw new Error("Enter a prompt or reminder (up to 15,000 characters).");
  if (draft.kind !== "reminder" && draft.kind !== "prompt") throw new Error("Invalid task type.");
  if (!["once", "daily", "weekly", "interval"].includes(draft.repeat)) throw new Error("Invalid repeat setting.");
  if (!Number.isFinite(draft.startsAt)) throw new Error("Choose a valid date and time.");
  if (draft.repeat === "interval" && (!Number.isInteger(draft.intervalMinutes) || draft.intervalMinutes < 15 || draft.intervalMinutes > 10_080)) {
    throw new Error("Interval must be between 15 and 10,080 minutes.");
  }
  return { ...draft, title, prompt, intervalMinutes: draft.repeat === "interval" ? draft.intervalMinutes : 60,
    allowTools: draft.kind === "prompt" && draft.allowTools === true,
    allowMcpTools: draft.kind === "prompt" && draft.allowTools === true && draft.allowMcpTools === true,
  };
}

function sanitizeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/#|\[|\]|\*|\|/g, "").trim();
}

export class ScheduledTaskManager {
  private inProgress = new Set<string>();
  private saveQueue: Promise<void> = Promise.resolve();
  private controllers = new Map<string, AbortController>();
  private closed = false;
  private checking = false;

  constructor(private plugin: LocalLlmHubPlugin) {}

  start(): void {
    this.plugin.registerInterval(window.setInterval(() => { void this.checkDue(); }, 15_000));
    void this.checkDue();
  }

  stop(): void {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  list(): ScheduledTask[] {
    return [...(this.plugin.settings.scheduledTasks || [])];
  }

  private changed(): void {
    this.plugin.settingsEmitter.emit("scheduled-tasks-changed");
  }

  private async persist(): Promise<void> {
    // Concurrent completions cannot allow an older settings snapshot to
    // overwrite a newer one, even when two jobs finish nearly simultaneously.
    const saving = this.saveQueue.catch(() => undefined).then(() => this.plugin.saveSettings());
    this.saveQueue = saving;
    await saving;
  }

  async upsert(draft: TaskDraft, existingId?: string): Promise<ScheduledTask> {
    const input = validateTask(draft);
    const now = Date.now();
    if (input.repeat === "once" && input.startsAt <= now && !existingId) {
      throw new Error("One-time tasks must start in the future.");
    }
    const tasks = this.plugin.settings.scheduledTasks || [];
    const original = existingId ? tasks.find(item => item.id === existingId) : undefined;
    if (existingId && !original) throw new Error("Task not found.");
    if (existingId && this.inProgress.has(existingId)) throw new Error("Wait for the running task to finish before editing it.");
    const scheduleChanged = !original
      || original.startsAt !== input.startsAt
      || original.repeat !== input.repeat
      || original.intervalMinutes !== input.intervalMinutes;
    const nextRunAt = scheduleChanged
      ? input.startsAt > now ? input.startsAt
        : input.repeat === "once" ? now
          : nextOccurrence(input, now)
      : original.nextRunAt;
    const task: ScheduledTask = {
      ...original,
      ...input,
      id: original?.id || randomUUID(),
      createdAt: original?.createdAt || now,
      enabled: original?.enabled ?? true,
      nextRunAt,
    };
    this.plugin.settings.scheduledTasks = original
      ? tasks.map(item => item.id === task.id ? task : item)
      : [...tasks, task];
    this.changed();
    await this.persist();
    return task;
  }

  async remove(id: string): Promise<void> {
    if (this.inProgress.has(id)) throw new Error("Cannot delete a running task.");
    this.plugin.settings.scheduledTasks = this.list().filter(task => task.id !== id);
    this.changed();
    await this.persist();
  }

  async toggle(id: string): Promise<void> {
    const task = this.list().find(item => item.id === id);
    if (!task) throw new Error("Task not found.");
    if (this.inProgress.has(id)) throw new Error("Cannot pause a running task.");
    if (!task.enabled && task.repeat === "once" && task.nextRunAt === null) {
      throw new Error("This one-time schedule has finished. Edit its first-run time to schedule it again.");
    }
    task.enabled = !task.enabled;
    if (task.enabled && (task.nextRunAt == null || task.repeat !== "once" && task.nextRunAt < Date.now())) {
      task.nextRunAt = task.startsAt > Date.now() ? task.startsAt : nextOccurrence(task, Date.now());
    }
    this.changed();
    await this.persist();
    if (task.enabled) void this.checkDue();
  }

  async runNow(id: string): Promise<void> {
    const task = this.list().find(item => item.id === id);
    if (!task) throw new Error("Task not found.");
    await this.execute(task, true);
  }

  private async checkDue(): Promise<void> {
    if (this.closed || this.checking) return;
    this.checking = true;
    try {
      // Recheck on startup and after resume; only one occurrence is processed
      // per overdue recurring task. No replay storm after a long absence.
      for (const task of this.list()) {
        if (this.closed) break;
        if (task.enabled && task.nextRunAt !== null && task.nextRunAt <= Date.now() && !this.inProgress.has(task.id)) {
          await this.execute(task, false);
        }
      }
    } finally {
      this.checking = false;
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const segment of path.split("/").filter(Boolean)) {
      current = current ? current + "/" + segment : segment;
      if (!this.plugin.app.vault.getAbstractFileByPath(current)) {
        await this.plugin.app.vault.createFolder(current);
      }
    }
  }

  private async logRun(task: ScheduledTask, at: number, output: string, audit: ScheduledToolAudit[], error?: string): Promise<string> {
    const root = (this.plugin.settings.workspaceFolder || "LocalLlmHub").replace(/^\/|\/$/g, "");
    const folder = root + "/scheduler/runs/" + task.id;
    await this.ensureFolder(folder);
    const path = folder + "/" + new Date(at).toISOString().replace(/[:.]/g, "-") + ".md";
    const lines = [
      "# " + sanitizeHeading(task.title),
      "",
      "- Scheduled task: " + task.id,
      "- Run time: " + new Date(at).toISOString(),
      "- Kind: " + task.kind,
      "- Unattended vault tools: " + (task.allowTools === true ? "enabled" : "disabled"),
      "- Unattended MCP tools: " + (task.allowTools === true && task.allowMcpTools === true ? "enabled" : "disabled"),
      "- Status: " + (error ? "failed" : "success"),
      "",
      "## Instruction",
      "",
      task.prompt,
      "",
      "## " + (error ? "Error" : "Result"),
      "",
      output,
      "",
      ...(audit.length ? [
        "## Tool activity", "",
        ...audit.map(entry => "- " + (entry.success ? "Success" : "Failed") + ": `" + entry.name + "`" +
          (entry.target ? " (" + entry.target.replace(/[\r\n]/g, " ") + ")" : "") + " — " + entry.detail.replace(/[\r\n]/g, " ")),
        "",
      ] : []),
    ];
    // Task IDs and filenames are controlled by the scheduler, not by a model.
    await this.plugin.app.vault.create(path, lines.join("\n"));
    return path;
  }

  private async generate(task: ScheduledTask, signal: AbortSignal, audit: ScheduledToolAudit[]): Promise<string> {
    return runScheduledAgent(task, this.plugin, signal, audit);
  }

  private async execute(task: ScheduledTask, manual: boolean): Promise<void> {
    if (this.closed || this.inProgress.has(task.id)) return;
    this.inProgress.add(task.id);
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    const at = Date.now();
    const audit: ScheduledToolAudit[] = [];
    task.lastRunAt = at;
    task.lastStatus = "running";
    task.lastError = undefined;
    if (!manual) {
      task.nextRunAt = nextOccurrence(task, at);
      if (task.nextRunAt === null) task.enabled = false;
    }
    this.changed();
    try {
      // Reserve the occurrence before invoking the model. This avoids
      // repeated execution if a scheduler tick arrives during a long run.
      await this.persist();
      const output = task.kind === "reminder" ? task.prompt : await this.generate(task, controller.signal, audit);
      if (this.closed) return;
      task.lastResultPath = await this.logRun(task, at, output, audit);
      task.lastStatus = "success";
      new Notice(task.kind === "reminder"
        ? "Mabel reminder: " + task.title + "\n" + task.prompt.slice(0, 160)
        : "Mabel finished: " + task.title, 9000);
    } catch (cause) {
      if (this.closed) return;
      task.lastStatus = "failed";
      task.lastError = cause instanceof Error ? cause.message : String(cause);
      try {
        task.lastResultPath = await this.logRun(task, at, task.lastError, audit, task.lastError);
      } catch (loggingError) {
        console.error("[Mabel scheduler] Failed to save execution log:", loggingError);
      }
      new Notice("Mabel schedule failed: " + task.title, 7500);
    } finally {
      this.inProgress.delete(task.id);
      this.controllers.delete(task.id);
      this.changed();
      if (!this.closed) {
        try { await this.persist(); } catch (error) { console.error("[Mabel scheduler] Save failed:", error); }
      }
    }
  }
}

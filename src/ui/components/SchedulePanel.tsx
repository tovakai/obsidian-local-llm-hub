import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock3, Plus, Pencil, Play, Pause, Trash2, Sparkles, Bell, BrainCircuit, FileText, X, Check, AlertCircle, Repeat2 } from "lucide-react";
import { Notice } from "obsidian";
import type { LocalLlmHubPlugin } from "../../plugin";
import type { ScheduledTask, ScheduleKind, ScheduleRepeat, TaskDraft } from "../../core/scheduler";

interface SchedulePanelProps { plugin: LocalLlmHubPlugin; }

function localInput(timestamp: number): string {
  const date = new Date(timestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function newDraft(): TaskDraft {
  return {
    title: "",
    prompt: "",
    kind: "reminder",
    repeat: "once",
    intervalMinutes: 60,
    startsAt: Math.ceil((Date.now() + 60 * 60_000) / (5 * 60_000)) * (5 * 60_000),
  };
}

function when(timestamp: number | null): string {
  if (timestamp == null) return "No upcoming run";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(timestamp);
}

function cadence(task: ScheduledTask): string {
  switch (task.repeat) {
    case "once": return "Once";
    case "daily": return "Every day";
    case "weekly": return "Every week";
    case "interval": return "Every " + task.intervalMinutes + " min";
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default function SchedulePanel({ plugin }: SchedulePanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>(() => plugin.scheduler.list());
  const [editing, setEditing] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(newDraft);
  const [dateInput, setDateInput] = useState(() => localInput(newDraft().startsAt));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const refresh = () => setTasks(plugin.scheduler.list());
    plugin.settingsEmitter.on("scheduled-tasks-changed", refresh);
    plugin.settingsEmitter.on("settings-updated", refresh);
    refresh();
    return () => {
      plugin.settingsEmitter.off("scheduled-tasks-changed", refresh);
      plugin.settingsEmitter.off("settings-updated", refresh);
    };
  }, [plugin]);

  useEffect(() => {
    const onProposed = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const proposal = value as Record<string, unknown>;
      const initial = newDraft();
      const dateText = typeof proposal.startsAtLocal === "string" ? proposal.startsAtLocal : localInput(initial.startsAt);
      const parsed = new Date(dateText).getTime();
      const next: TaskDraft = {
        title: typeof proposal.title === "string" ? proposal.title : "",
        prompt: typeof proposal.prompt === "string" ? proposal.prompt : "",
        kind: proposal.kind === "prompt" ? "prompt" : "reminder",
        repeat: ["daily", "weekly", "interval"].includes(String(proposal.repeat))
          ? proposal.repeat as ScheduleRepeat : "once",
        intervalMinutes: typeof proposal.intervalMinutes === "number" ? proposal.intervalMinutes : 60,
        startsAt: parsed,
      };
      setDraft(next);
      setDateInput(dateText);
      setEditing(null);
      setError("Review this proposed task and click Save schedule to approve it.");
      setIsCreating(true);
    };
    plugin.settingsEmitter.on("schedule-draft", onProposed);
    return () => plugin.settingsEmitter.off("schedule-draft", onProposed);
  }, [plugin]);

  const sorted = useMemo(() => [...tasks].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return (a.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (b.nextRunAt ?? Number.MAX_SAFE_INTEGER);
  }), [tasks]);
  const activeCount = tasks.filter(t => t.enabled).length;
  const nextTask = sorted.find(t => t.enabled && t.nextRunAt !== null);

  function startCreate(kind: ScheduleKind = "reminder"): void {
    const initial = { ...newDraft(), kind };
    setDraft(initial);
    setDateInput(localInput(initial.startsAt));
    setEditing(null);
    setError("");
    setIsCreating(true);
  }

  function startEdit(task: ScheduledTask): void {
    setDraft({
      title: task.title,
      prompt: task.prompt,
      kind: task.kind,
      repeat: task.repeat,
      intervalMinutes: task.intervalMinutes,
      startsAt: task.startsAt,
    });
    setDateInput(localInput(task.startsAt));
    setEditing(task.id);
    setError("");
    setIsCreating(true);
  }

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await plugin.scheduler.upsert(draft, editing ?? undefined);
      setIsCreating(false);
      setEditing(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  async function action(task: ScheduledTask, operation: "toggle" | "remove" | "run"): Promise<void> {
    if (operation === "remove" && !window.confirm("Delete " + task.title + "? Existing run notes will stay in the vault.")) return;
    try {
      if (operation === "toggle") await plugin.scheduler.toggle(task.id);
      if (operation === "remove") await plugin.scheduler.remove(task.id);
      if (operation === "run") {
        new Notice("Mabel is running: " + task.title);
        void plugin.scheduler.runNow(task.id).catch(cause => new Notice(errorText(cause)));
      }
    } catch (cause) {
      new Notice(errorText(cause));
    }
  }

  return (
    <div className="llm-hub-scheduler">
      <header className="llm-hub-scheduler-hero">
        <div className="llm-hub-scheduler-eyebrow"><Sparkles size={13} /> MABEL / AUTOMATIONS</div>
        <h2>Time is on her side.</h2>
        <p>Reminders and quiet local-model jobs, right inside your vault.</p>
        <div className="llm-hub-scheduler-overview">
          <div className="llm-hub-scheduler-stat">
            <strong>{activeCount}</strong><span>Active {activeCount === 1 ? "schedule" : "schedules"}</span>
          </div>
          <div className="llm-hub-scheduler-stat llm-hub-scheduler-next">
            <Clock3 size={15} />
            <span>{nextTask?.nextRunAt != null ? when(nextTask.nextRunAt) : "Nothing queued"}</span>
          </div>
        </div>
        <button type="button" className="llm-hub-scheduler-add" onClick={() => startCreate()}>
          <Plus size={16} /> New schedule
        </button>
      </header>

      {isCreating && (
        <section className="llm-hub-scheduler-editor" aria-label="Schedule editor">
          <div className="llm-hub-scheduler-section-title">
            <strong>{editing ? "Edit schedule" : "Create schedule"}</strong>
            <button type="button" className="llm-hub-scheduler-icon" onClick={() => setIsCreating(false)} aria-label="Close editor"><X size={17} /></button>
          </div>
          <div className="llm-hub-scheduler-choice" role="group" aria-label="Task kind">
            <button type="button" className={draft.kind === "reminder" ? "is-selected" : ""} onClick={() => setDraft(v => ({ ...v, kind: "reminder" }))}><Bell size={15} /> Reminder</button>
            <button type="button" className={draft.kind === "prompt" ? "is-selected" : ""} onClick={() => setDraft(v => ({ ...v, kind: "prompt" }))}><BrainCircuit size={15} /> AI prompt</button>
          </div>
          <label className="llm-hub-scheduler-field">Name
            <input type="text" value={draft.title} maxLength={120} placeholder="e.g. Review today's projects"
              onChange={event => setDraft(v => ({ ...v, title: event.target.value }))} />
          </label>
          <label className="llm-hub-scheduler-field">{draft.kind === "reminder" ? "Reminder text" : "Instruction for Mabel"}
            <textarea rows={4} value={draft.prompt}
              placeholder={draft.kind === "reminder" ? "What should I remind you about?" : "Summarize a topic, reflect on a project, or prepare a daily brief..."}
              onChange={event => setDraft(v => ({ ...v, prompt: event.target.value }))} />
          </label>
          <div className="llm-hub-scheduler-fields">
            <label className="llm-hub-scheduler-field">First run
              <input type="datetime-local" value={dateInput}
                onChange={event => {
                  setDateInput(event.target.value);
                  setDraft(v => ({ ...v, startsAt: new Date(event.target.value).getTime() }));
                }} />
            </label>
            <label className="llm-hub-scheduler-field">Repeat
              <select value={draft.repeat} onChange={event => setDraft(v => ({ ...v, repeat: event.target.value as ScheduleRepeat }))}>
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="interval">Interval</option>
              </select>
            </label>
          </div>
          {draft.repeat === "interval" && (
            <label className="llm-hub-scheduler-field">Every N minutes (15–10080)
              <input type="number" min={15} max={10080} step={5} value={draft.intervalMinutes}
                onChange={event => setDraft(v => ({ ...v, intervalMinutes: Number(event.target.value) }))} />
            </label>
          )}
          <div className="llm-hub-scheduler-hint">
            <AlertCircle size={14} />
            <span>{draft.kind === "prompt"
              ? "Runs the configured local model and saves the response to the vault. Scheduled prompts cannot call tools or edit existing notes."
              : "Shows an Obsidian notification and saves a reminder record in the vault."}</span>
          </div>
          {error && <p className="llm-hub-scheduler-error" role="alert">{error}</p>}
          <div className="llm-hub-scheduler-actions">
            <button type="button" onClick={() => setIsCreating(false)}>Cancel</button>
            <button type="button" className="mod-cta" disabled={saving} onClick={() => { void save(); }}><Check size={15} /> {saving ? "Saving..." : "Save schedule"}</button>
          </div>
        </section>
      )}

      <div className="llm-hub-scheduler-list-heading">
        <span><CalendarClock size={17} /> Your schedules</span>
        <span className="llm-hub-scheduler-count">{tasks.length}</span>
      </div>

      {sorted.length === 0 ? (
        <div className="llm-hub-scheduler-empty">
          <Repeat2 size={27} strokeWidth={1.5} />
          <strong>No schedules yet</strong>
          <p>Make something happen later. Mabel will take it from there.</p>
          <button type="button" onClick={() => startCreate("prompt")}>Schedule an AI prompt</button>
        </div>
      ) : sorted.map(task => (
        <article key={task.id} className={"llm-hub-scheduler-card" + (task.enabled ? "" : " is-paused")}>
          <div className="llm-hub-scheduler-card-top">
            <div className={"llm-hub-scheduler-type " + (task.kind === "prompt" ? "is-ai" : "is-reminder")}>
              {task.kind === "prompt" ? <BrainCircuit size={15} /> : <Bell size={15} />}
            </div>
            <div className="llm-hub-scheduler-card-name"><strong>{task.title}</strong>
              <span>{cadence(task)}</span>
            </div>
            <span className={"llm-hub-scheduler-state " + (task.enabled ? "is-on" : "")}>{task.enabled ? "On" : "Paused"}</span>
          </div>
          <p className="llm-hub-scheduler-prompt">{task.prompt}</p>
          <div className="llm-hub-scheduler-meta">
            <span><Clock3 size={13} /> {task.enabled ? when(task.nextRunAt) : "Not running"}</span>
            {task.lastStatus && <span className={"llm-hub-scheduler-status is-" + task.lastStatus}>{task.lastStatus === "running" ? "Running..." : task.lastStatus === "success" ? "Last run succeeded" : "Last run failed"}</span>}
          </div>
          {task.lastStatus === "failed" && task.lastError && <div className="llm-hub-scheduler-run-error">{task.lastError}</div>}
          <div className="llm-hub-scheduler-card-actions">
            <button type="button" disabled={task.lastStatus === "running"} onClick={() => { void action(task, "run"); }} title="Run now"><Play size={14} /> Run</button>
            <button type="button" disabled={task.lastStatus === "running"} onClick={() => { void action(task, "toggle"); }} title={task.enabled ? "Pause" : "Resume"}>{task.enabled ? <Pause size={14} /> : <Play size={14} />} {task.enabled ? "Pause" : "Resume"}</button>
            {task.lastResultPath && <button type="button" onClick={() => { void plugin.app.workspace.openLinkText(task.lastResultPath!, "", false); }} title="View last run"><FileText size={14} /></button>}
            <button type="button" disabled={task.lastStatus === "running"} onClick={() => startEdit(task)} title="Edit"><Pencil size={14} /></button>
            <button type="button" disabled={task.lastStatus === "running"} onClick={() => { void action(task, "remove"); }} title="Delete"><Trash2 size={14} /></button>
          </div>
        </article>
      ))}
      <p className="llm-hub-scheduler-footer"><AlertCircle size={13} /> Schedules run while Obsidian desktop is open. Missed tasks fire once when it reopens; recurring runs do not pile up.</p>
    </div>
  );
}

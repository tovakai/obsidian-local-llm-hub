import { useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, Clock3, FileText, Filter, Search, Sparkles, Terminal, XCircle } from "lucide-react";
import type { LocalLlmHubPlugin } from "../../plugin";
import type { ActivityEvent } from "../../core/activityLog";

interface ActivityPanelProps { plugin: LocalLlmHubPlugin; }
type FeedFilter = "all" | "sleep" | "tools" | "errors";

const categories: { id: FeedFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "sleep", label: "Memory" },
  { id: "tools", label: "Tools" },
  { id: "errors", label: "Errors" },
];

function dateAt(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(timestamp));
}

function timeAt(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(timestamp));
}

function iconFor(kind: ActivityEvent["kind"]) {
  if (kind === "run-error" || kind === "tool-error") return <XCircle size={14} />;
  if (kind === "run-complete" || kind === "tool-success") return <CheckCircle2 size={14} />;
  if (kind.startsWith("memory")) return <Sparkles size={14} />;
  if (kind.startsWith("tool")) return <Terminal size={14} />;
  return <Clock3 size={14} />;
}

function groupsFor(events: ActivityEvent[], filter: FeedFilter, search: string) {
  const grouped = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    if (!grouped.has(event.runId)) grouped.set(event.runId, []);
    grouped.get(event.runId)!.push(event);
  }
  const query = search.trim().toLowerCase();
  return Array.from(grouped.entries()).map(([runId, entries]) => {
    const started = entries.find(e => e.kind === "run-start");
    const name = started?.title || entries[entries.length - 1]?.title || "Mabel activity";
    const completed = entries.find(e => e.kind === "run-complete");
    const failed = entries.find(e => e.kind === "run-error");
    const report = entries.find(e => e.kind === "memory-report")
      || completed || failed || entries.find(e => e.path);
    const status = failed ? "error" : completed ? "complete" : "running";
    return { runId, entries, name, status, report, latestAt: entries[0]?.timestamp || 0 };
  }).filter(group => {
    if (filter === "sleep" && !group.entries.some(e => e.source === "sleep")) return false;
    if (filter === "tools" && !group.entries.some(e => e.kind.startsWith("tool"))) return false;
    if (filter === "errors" && !group.entries.some(e => e.kind === "run-error" || e.kind === "tool-error")) return false;
    return !query || group.name.toLowerCase().includes(query)
      || group.entries.some(e => [e.title, e.detail, e.path].some(value => value?.toLowerCase().includes(query)));
  }).sort((a, b) => b.latestAt - a.latestAt);
}

export default function ActivityPanel({ plugin }: ActivityPanelProps) {
  const [events, setEvents] = useState<ActivityEvent[]>(() => plugin.activityLog.list());
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const refresh = () => setEvents(plugin.activityLog.list());
    plugin.settingsEmitter.on("mabel-activity-changed", refresh);
    plugin.settingsEmitter.on("settings-updated", refresh);
    refresh();
    return () => {
      plugin.settingsEmitter.off("mabel-activity-changed", refresh);
      plugin.settingsEmitter.off("settings-updated", refresh);
    };
  }, [plugin]);

  const groups = useMemo(() => groupsFor(events, filter, search), [events, filter, search]);
  const running = groupsFor(events, "all", "").filter(group => group.status === "running").length;
  const errors = events.filter(e => e.kind === "run-error" || e.kind === "tool-error").length;

  return (
    <div className="llm-hub-activity">
      <header className="llm-hub-activity-header">
        <div className="llm-hub-activity-heading"><Activity size={18} /><h2>Activity</h2></div>
        <p>What Mabel did, when, and where to find the results.</p>
        <div className="llm-hub-activity-stats">
          <span><strong>{events.length}</strong> recorded events</span>
          <span className="is-live"><span className="llm-hub-activity-pulse" /> {running} running</span>
          {errors > 0 && <span className="is-error"><AlertCircle size={12} /> {errors} errors</span>}
        </div>
      </header>

      <div className="llm-hub-activity-controls">
        <div className="llm-hub-activity-search"><Search size={15} />
          <input type="search" placeholder="Search activity..." value={search}
            aria-label="Search activity log" onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="llm-hub-activity-filters" role="group" aria-label="Activity filter">
          <Filter size={14} />
          {categories.map(item =>
            <button key={item.id} type="button" className={filter === item.id ? "is-selected" : ""}
              onClick={() => setFilter(item.id)}>{item.label}</button>)}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="llm-hub-activity-empty">
          <Activity size={28} strokeWidth={1.4} />
          <strong>{events.length ? "Nothing matches yet" : "Quiet in here"}</strong>
          <p>{events.length ? "Try another search or filter." : "Scheduled tasks and /sleep runs will appear here as they happen."}</p>
        </div>
      ) : (
        <div className="llm-hub-activity-feed">
          {groups.map(group => (
            <article key={group.runId} className="llm-hub-activity-run">
              <div className="llm-hub-activity-run-head">
                <div className={"llm-hub-activity-run-icon is-" + group.status}>
                  {group.status === "complete" ? <CheckCircle2 size={17} /> :
                    group.status === "error" ? <XCircle size={17} /> : <Clock3 size={17} />}
                </div>
                <div className="llm-hub-activity-run-name">
                  <strong>{group.name}</strong>
                  <span>{dateAt(group.latestAt)}</span>
                </div>
                <span className={"llm-hub-activity-state is-" + group.status}>
                  {group.status === "complete" ? "Done" : group.status === "error" ? "Failed" : "Running"}
                </span>
              </div>
              <div className="llm-hub-activity-run-meta">
                {group.entries.length} events
                {group.entries.some(e => e.source === "sleep") ? " · Memory review" : " · Scheduled job"}
              </div>
              {group.report?.path && (
                <button className="llm-hub-activity-report" type="button"
                  onClick={() => { void plugin.app.workspace.openLinkText(group.report!.path!, "", false); }}>
                  <FileText size={14} /> Open {group.report.kind === "memory-report" ? "sleep report" : "run note"}
                </button>
              )}
              <details className="llm-hub-activity-trace" open={group.status === "running" ? true : undefined}>
                <summary>Execution timeline</summary>
                <div className="llm-hub-activity-events">
                  {[...group.entries].reverse().map(event => (
                    <div className={"llm-hub-activity-event is-" + event.kind} key={event.id}>
                      <div className="llm-hub-activity-event-symbol">{iconFor(event.kind)}</div>
                      <div className="llm-hub-activity-event-text">
                        <strong>{event.title}</strong>
                        {event.detail && <span>{event.detail}</span>}
                        {event.path && <button type="button" className="llm-hub-activity-path" title={event.path}
                          onClick={() => { void plugin.app.workspace.openLinkText(event.path!, "", false); }}>
                          {event.path}
                        </button>}
                      </div>
                      <time>{timeAt(event.timestamp)}</time>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
      <p className="llm-hub-activity-note">Last 600 events are kept across Obsidian restarts. This feed records tool names and file paths, not prompts or tool arguments. Detailed run reports are stored in the vault.</p>
    </div>
  );
}

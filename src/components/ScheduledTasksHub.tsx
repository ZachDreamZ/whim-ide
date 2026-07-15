import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock3, LoaderCircle, Pause, Pencil, Play, PlayCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { bridge, type OrchestrationJobMode, type ScheduledTask, type ScheduleRecurrence } from "../lib/bridge";

const MODES: OrchestrationJobMode[] = ["vibe", "plan", "research", "build", "verify", "review", "ship", "operate"];
const RECURRENCES: { value: ScheduleRecurrence; label: string }[] = [
  { value: "once", label: "Once" }, { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" }, { value: "weekly", label: "Weekly" },
];

function localInputValue(timestamp = Date.now() + 5 * 60_000) {
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function scheduleLabel(task: ScheduledTask) {
  const date = new Date(task.nextRunAtMs).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  if (task.recurrence === "once") return date;
  return `${task.recurrence === "weekdays" ? "Weekdays" : task.recurrence[0].toUpperCase() + task.recurrence.slice(1)} · ${date}`;
}

export function ScheduledTasksHub({ workspace }: { workspace: string }) {
  const native = bridge.isNative();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [recurrence, setRecurrence] = useState<ScheduleRecurrence>("once");
  const [nextRun, setNextRun] = useState(() => localInputValue());
  const [mode, setMode] = useState<OrchestrationJobMode>("build");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!native) return;
    try { setTasks(await bridge.listScheduledTasks(workspace)); setMessage(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load schedules."); }
  }, [native, workspace]);

  useEffect(() => { void refresh(); }, [refresh]);

  const reset = () => {
    setEditingId(undefined); setTitle(""); setPrompt(""); setRecurrence("once"); setNextRun(localInputValue()); setMode("build"); setComposerOpen(false);
  };

  const save = async () => {
    const timestamp = new Date(nextRun).getTime();
    if (!title.trim() || !prompt.trim() || !Number.isFinite(timestamp)) return;
    setBusy(true);
    try {
      await bridge.saveScheduledTask({ workspace, id: editingId, title, prompt, recurrence, nextRunAtMs: timestamp, mode });
      reset(); await refresh(); setMessage(editingId ? "Schedule updated." : "Schedule created.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the schedule."); }
    finally { setBusy(false); }
  };

  const edit = (task: ScheduledTask) => {
    setEditingId(task.id); setTitle(task.title); setPrompt(task.prompt); setRecurrence(task.recurrence);
    setNextRun(localInputValue(task.nextRunAtMs)); setMode(task.mode); setComposerOpen(true);
  };

  const useSuggestion = (kind: "daily" | "weekly" | "followup") => {
    const now = new Date();
    const next = new Date(now);
    const hour = kind === "weekly" ? 16 : kind === "daily" ? 8 : 9;
    next.setHours(hour, 0, 0, 0);
    if (kind === "weekly") {
      const days = (5 - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + (days === 0 && next <= now ? 7 : days));
    } else {
      if (next <= now) next.setDate(next.getDate() + 1);
      while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    }
    const values = kind === "daily"
      ? { title: "Daily brief", prompt: "Start each weekday with a summary of this workspace, current tasks, and priorities.", recurrence: "weekdays" as const, mode: "research" as const }
      : kind === "weekly"
        ? { title: "Weekly review", prompt: "Turn the recent work in this workspace into a concise status update every Friday.", recurrence: "weekly" as const, mode: "review" as const }
        : { title: "Follow-up monitor", prompt: "Review recent workspace activity and flag anything that needs attention.", recurrence: "weekdays" as const, mode: "operate" as const };
    setTitle(values.title); setPrompt(values.prompt); setRecurrence(values.recurrence); setMode(values.mode); setNextRun(localInputValue(next.getTime())); setComposerOpen(true);
  };

  const toggle = async (task: ScheduledTask) => {
    await bridge.toggleScheduledTask(workspace, task.id, !task.enabled); await refresh();
  };

  const remove = async (task: ScheduledTask) => {
    await bridge.deleteScheduledTask(workspace, task.id); if (editingId === task.id) reset(); await refresh();
  };

  const runNow = async (task: ScheduledTask) => {
    setBusy(true);
    try {
      const job = await bridge.createOrchestrationJob({ workspace, intent: task.prompt, title: task.title, mode: task.mode, provider: task.provider ?? undefined, model: task.model ?? undefined });
      await bridge.markScheduledTaskRun(workspace, task.id, job.id);
      await bridge.dispatchOrchestrationJob({ workspace, jobId: job.id });
      setMessage(`Started “${task.title}”.`); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not run the schedule."); }
    finally { setBusy(false); }
  };

  const sorted = useMemo(() => [...tasks].sort((a, b) => a.nextRunAtMs - b.nextRunAtMs), [tasks]);

  return (
    <main className="hub-page integration-page" aria-label="Scheduled tasks">
      <header className="integration-hero">
        <div><span className="section-kicker"><CalendarClock size={13} /> Scheduled</span><h1>Scheduled tasks</h1><p>Ask Whim to schedule tasks, set reminders, or monitor this workspace for updates.</p></div>
        <button className="primary-action" type="button" onClick={() => setComposerOpen(true)} disabled={!native}><Plus size={15} /> Create</button>
      </header>

      {message && <div className="inline-notice"><span>{message}</span></div>}
      {composerOpen && (
        <section className="integration-composer">
          <div className="section-heading-row"><div><span className="section-kicker"><Plus size={12} /> {editingId ? "Edit" : "Create"}</span><h2>{editingId ? "Update task" : "Schedule a task"}</h2></div><button className="text-action" type="button" onClick={reset}>Cancel</button></div>
          <label className="field"><span>Name</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Daily repository health check" disabled={!native} /></label>
          <label className="field"><span>Instructions</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Inspect the workspace, run checks, and summarize actionable failures." rows={5} disabled={!native} /></label>
          <div className="field-row">
            <label className="field"><span>Repeats</span><select value={recurrence} onChange={(event) => setRecurrence(event.target.value as ScheduleRecurrence)} disabled={!native}>{RECURRENCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="field"><span>Next run</span><input type="datetime-local" value={nextRun} onChange={(event) => setNextRun(event.target.value)} disabled={!native} /></label>
            <label className="field"><span>Agent mode</span><select value={mode} onChange={(event) => setMode(event.target.value as OrchestrationJobMode)} disabled={!native}>{MODES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </div>
          <button className="primary-action" type="button" onClick={() => void save()} disabled={!native || busy || !title.trim() || !prompt.trim()}>{busy ? <LoaderCircle className="spin" size={15} /> : <CalendarClock size={15} />} {editingId ? "Save changes" : "Create schedule"}</button>
          <p className="integration-footnote"><Clock3 size={12} /> Times use your Windows timezone. Missed runs are claimed once when Whim next checks this workspace.</p>
        </section>
      )}

        <section className="integration-board full-width">
          <div className="section-heading-row"><div><span className="section-kicker"><Clock3 size={12} /> Workspace automations</span><h2>{tasks.length} scheduled</h2></div><button className="secondary-action" type="button" onClick={() => void refresh()} disabled={!native}><RefreshCw size={13} /> Refresh</button></div>
          {sorted.length === 0 ? <div className="schedule-suggestions"><h3>Suggestions</h3><div className="suggestion-grid">
            <button type="button" onClick={() => useSuggestion("daily")}><CalendarClock size={18} /><strong>Daily brief</strong><span>Weekdays at 8:00 AM</span><p>Start each weekday with a summary of your workspace and priorities</p></button>
            <button type="button" onClick={() => useSuggestion("weekly")}><CalendarClock size={18} /><strong>Weekly review</strong><span>Fridays at 4:00 PM</span><p>Turn your recent work into a concise status update every Friday</p></button>
            <button type="button" onClick={() => useSuggestion("followup")}><CalendarClock size={18} /><strong>Follow-up monitor</strong><span>Weekdays at 9:00 AM</span><p>Review recent workspace activity and flag anything that needs attention</p></button>
          </div></div> : (
            <ul className="integration-list">{sorted.map((task) => <li className={`integration-card ${task.enabled ? "" : "muted"}`} key={task.id}>
              <div className="integration-card-main"><div className="integration-icon"><CalendarClock size={17} /></div><div><strong>{task.title}</strong><p>{task.prompt}</p><span>{scheduleLabel(task)} · {task.mode}</span>{task.lastRunAtMs && <span>Last started {new Date(task.lastRunAtMs).toLocaleString()}</span>}</div></div>
              <div className="integration-card-actions"><button type="button" onClick={() => void runNow(task)} disabled={busy} title="Run now"><PlayCircle size={14} /></button><button type="button" onClick={() => edit(task)} title="Edit"><Pencil size={14} /></button><button type="button" onClick={() => void toggle(task)} title={task.enabled ? "Pause" : "Resume"}>{task.enabled ? <Pause size={14} /> : <Play size={14} />}</button><button type="button" onClick={() => void remove(task)} title="Delete"><Trash2 size={14} /></button></div>
            </li>)}</ul>
          )}
        </section>
    </main>
  );
}

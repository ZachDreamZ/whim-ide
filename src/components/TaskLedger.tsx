import { ChevronDown, History, RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { OrchestrationJob, OrchestrationJobDetail } from "../lib/bridge";
import { displayWorkflowMode } from "../lib/agent-workflow";

type TaskLedgerProps = {
  native: boolean;
  jobs: OrchestrationJob[];
  activeJob: OrchestrationJob | null;
  detail: OrchestrationJobDetail | null;
  loading?: boolean;
  onRefresh: () => void;
  onSelect: (job: OrchestrationJob) => void;
  onRetry?: (job: OrchestrationJob) => void;
  onResume?: (job: OrchestrationJob) => void;
  onBackground?: (job: OrchestrationJob) => void;
  onCancel?: (job: OrchestrationJob) => void;
  retrying?: boolean;
};

function statusLabel(status: OrchestrationJob["status"]) {
  return status.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function targetLabel(workspace: string) {
  const segments = workspace.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "workspace";
}

function timestamp(value?: number | null) {
  if (!value) return "Not started";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function evidenceLabel(job: OrchestrationJob) {
  const evidence = job.evidence;
  if (evidence.eventCount === 0) {
    const activity = Math.max(0, job.eventCount - 2);
    return activity > 0
      ? `${activity} durable action${activity === 1 ? "" : "s"} recorded`
      : "No agent events recorded yet";
  }
  const tools = `${evidence.toolCallCount} tool call${evidence.toolCallCount === 1 ? "" : "s"}`;
  const duration = evidence.durationMs ? ` · ${(evidence.durationMs / 1000).toFixed(1)}s` : "";
  return `${tools}${duration}`;
}

export function TaskLedger({
  native,
  jobs,
  activeJob,
  detail,
  loading = false,
  onRefresh,
  onSelect,
  onRetry,
  onResume,
  onBackground,
  onCancel,
  retrying = false,
}: TaskLedgerProps) {
  const [expanded, setExpanded] = useState(false);
  const recent = useMemo(
    () => jobs.filter((job) => job.id !== activeJob?.id).slice(0, 2),
    [activeJob?.id, jobs],
  );
  const roster = useMemo(() => ({
    targets: new Set(jobs.map((job) => job.workspace.toLocaleLowerCase())).size,
    running: jobs.filter((job) => job.status === "running").length,
    queued: jobs.filter((job) => job.status === "queued").length,
    paused: jobs.filter((job) => job.status === "paused" || job.status === "interrupted").length,
  }), [jobs]);
  const selected = detail?.job.id === activeJob?.id ? detail : null;

  return (
    <section className="task-ledger" aria-label="Durable task ledger">
      <div className="task-ledger-heading">
        <span><History size={12} /> Task ledger <small>{native ? "local" : "Windows app"}</small></span>
        <button type="button" onClick={onRefresh} title="Refresh task ledger" aria-label="Refresh task ledger" disabled={loading || !native}>
          <RefreshCw className={loading ? "spin" : ""} size={12} />
        </button>
      </div>

      {!native ? <div className="task-ledger-empty"><ShieldCheck size={11} /> Task persistence is available in the installed Windows app.</div> : <>

      {jobs.length > 0 && (
        <div className="task-ledger-roster" aria-label="Execution target roster">
          <span><strong>{roster.targets}</strong> execution target{roster.targets === 1 ? "" : "s"}</span>
          <span>{roster.running}/{roster.targets} running · {roster.queued} queued{roster.paused ? ` · ${roster.paused} held` : ""}</span>
        </div>
      )}

      {activeJob ? (
        <>
          <button
            className="task-ledger-current"
            type="button"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((value) => !value);
              onSelect(activeJob);
            }}
          >
            <span className={`task-status ${activeJob.status}`}><ShieldCheck size={10} /> {statusLabel(activeJob.status)}</span>
            <span className="task-ledger-copy"><strong>{activeJob.title}</strong><small>{targetLabel(activeJob.workspace)} · {displayWorkflowMode(activeJob.mode)} · attempt {activeJob.attempt}/{activeJob.budget.maxAttempts} · risk {activeJob.risk} · #{shortId(activeJob.id)}</small></span>
            <ChevronDown className={expanded ? "expanded" : ""} size={13} />
          </button>
          {expanded && (
            <div className="task-ledger-detail">
              <p>{activeJob.intent}</p>
              <div className="task-ledger-meta"><span>{activeJob.nextEligibleAtMs && activeJob.nextEligibleAtMs > Date.now() ? `Eligible ${timestamp(activeJob.nextEligibleAtMs)}` : `Started ${timestamp(activeJob.startedAtMs)}`}</span><span>{evidenceLabel(activeJob)}</span></div>
              {onRetry && activeJob.mode !== "operate" && ["failed", "interrupted"].includes(activeJob.status) && activeJob.attempt < activeJob.budget.maxAttempts && (
                <button className="task-ledger-retry" type="button" disabled={retrying} onClick={() => onRetry(activeJob)}>
                  {retrying ? "Scheduling retry…" : `Retry attempt ${activeJob.attempt + 1}`}
                </button>
              )}
              {onResume && activeJob.mode !== "operate" && activeJob.status === "queued" && activeJob.attempt > 1 && (
                <button className="task-ledger-retry" type="button" disabled={retrying || Boolean(activeJob.nextEligibleAtMs && activeJob.nextEligibleAtMs > Date.now())} onClick={() => onResume(activeJob)}>
                  {retrying ? "Starting attempt…" : activeJob.nextEligibleAtMs && activeJob.nextEligibleAtMs > Date.now() ? `Eligible ${timestamp(activeJob.nextEligibleAtMs)}` : `Run queued attempt ${activeJob.attempt}`}
                </button>
              )}
              {onBackground && activeJob.status === "queued" && activeJob.operationId && (
                <button className="task-ledger-retry" type="button" disabled={retrying || Boolean(activeJob.nextEligibleAtMs && activeJob.nextEligibleAtMs > Date.now())} onClick={() => onBackground(activeJob)}>
                  {retrying ? "Dispatching…" : activeJob.mode === "operate" ? "Run janitor candidate" : "Run in background"}
                </button>
              )}
              {onCancel && activeJob.status === "running" && activeJob.operationId && (
                <button className="task-ledger-retry task-ledger-cancel" type="button" disabled={retrying} onClick={() => onCancel(activeJob)}>
                  Stop background task
                </button>
              )}
              {selected?.events.length ? (
                <ol className="task-ledger-events">
                  {selected.events.slice(-12).reverse().map((event) => (
                    <li key={event.id}><span>{event.kind}</span><p>{event.message}</p><time>{timestamp(event.atMs)}</time></li>
                  ))}
                </ol>
              ) : <small className="task-ledger-empty">Loading task evidence…</small>}
              <small className="task-ledger-retention">The durable trail stores fixed, redacted activity labels—not prompts, commands, or raw tool output.</small>
            </div>
          )}
        </>
      ) : (
        <div className="task-ledger-empty"><ShieldCheck size={11} /> Native tasks are recorded before they run.</div>
      )}

      {recent.length > 0 && (
        <div className="task-ledger-recent" aria-label="Recent tasks">
          {recent.map((job) => (
            <button key={job.id} type="button" onClick={() => { setExpanded(true); onSelect(job); }}>
              <span className={`task-status ${job.status}`}>{statusLabel(job.status)}</span><span title={`${targetLabel(job.workspace)} · ${job.title}`}>{targetLabel(job.workspace)} · {job.title}</span>
            </button>
          ))}
        </div>
      )}
      </>}
    </section>
  );
}

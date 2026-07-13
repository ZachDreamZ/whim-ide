import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  ListChecks,
  LoaderCircle,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
} from "lucide-react";
import {
  bridge,
  type OrchestrationJob,
  type OrchestrationJobMode,
  type OrchestrationJobStatus,
} from "../lib/bridge";

type OrchestrationPanelProps = { workspace: string };

type TransitionAction = "pause" | "resume" | "cancel";
type CardAction = TransitionAction | "retry";

const JOB_MODES: OrchestrationJobMode[] = [
  "vibe",
  "plan",
  "research",
  "build",
  "verify",
  "review",
  "ship",
  "operate",
];
const POLL_INTERVAL_MS = 2_500;

const STATUS_LABEL: Record<OrchestrationJobStatus, string> = {
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  interrupted: "Interrupted",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<OrchestrationJobStatus, string> = {
  queued: "neutral",
  running: "active",
  paused: "neutral",
  interrupted: "warn",
  completed: "good",
  failed: "bad",
  cancelled: "neutral",
};

// Map a job's current status to the controls that are legally available.
// Dispatch is separate (a queued job has not started running yet).
function availableActions(status: OrchestrationJobStatus): CardAction[] {
  switch (status) {
    case "queued":
    case "running":
      return ["pause", "cancel"];
    case "paused":
      return ["resume", "cancel"];
    case "interrupted":
    case "failed":
      return ["retry", "cancel"];
    default:
      return [];
  }
}

function evidenceSummary(job: OrchestrationJob): string {
  const evidence = job.evidence;
  if (!evidence || evidence.toolCallCount === 0) return "No evidence yet";
  return `${evidence.toolCallCount} tool call(s), ${evidence.failedToolCallCount} failed · ${evidence.eventCount} events`;
}

export function OrchestrationPanel({ workspace }: OrchestrationPanelProps) {
  const native = bridge.isNative();
  const [intent, setIntent] = useState("");
  const [mode, setMode] = useState<OrchestrationJobMode>("build");
  const [provider, setProvider] = useState("auto");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [jobs, setJobs] = useState<OrchestrationJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 4_200);
  }, []);

  const refreshJobs = useCallback(async () => {
    if (!native) return;
    try {
      const nextJobs = await bridge.listProjectOrchestrationJobs();
      setJobs(nextJobs);
    } catch (error) {
      // Non-fatal: keep the last known list if a background poll fails.
      const message = error instanceof Error ? error.message : "Could not load tasks.";
      showToast(message);
    }
  }, [showToast, native]);

  useEffect(() => {
    if (!native) return;
    void refreshJobs();
    pollTimer.current = window.setInterval(() => void refreshJobs(), POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    };
  }, [refreshJobs, native]);

  const createJob = async () => {
    if (!native || !intent.trim() || creating) return;
    setCreating(true);
    try {
      const job = await bridge.createOrchestrationJob({
        workspace,
        intent: intent.trim(),
        mode,
        provider: provider && provider !== "auto" ? provider : undefined,
        model: model.trim() || undefined,
      });
      setSelectedJobId(job.id);
      await refreshJobs();
      showToast(`Created task "${job.title}". Dispatch it to run the agent.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not create the task.");
    } finally {
      setCreating(false);
    }
  };

  const dispatchJob = async (jobId: string) => {
    if (!native || dispatching) return;
    setDispatching(true);
    try {
      await bridge.dispatchOrchestrationJob({
        workspace,
        jobId,
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      showToast("Task dispatched. The native agent is running.");
      await refreshJobs();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not dispatch the task.");
    } finally {
      setDispatching(false);
    }
  };

  const transitionJob = async (jobId: string, action: TransitionAction) => {
    if (!native) return;
    try {
      await bridge.transitionOrchestrationJob(workspace, jobId, action);
      await refreshJobs();
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Could not ${action} the task.`);
    }
  };

  const retryJob = async (jobId: string) => {
    if (!native) return;
    try {
      await bridge.retryOrchestrationJob({
        workspace,
        jobId,
        operationId: crypto.randomUUID(),
        delayMs: 0,
      });
      showToast("Retry queued with a fresh operation identity.");
      await refreshJobs();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not schedule a retry.");
    }
  };

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;

  return (
    <main className="hub-page orchestrate-page">
      <div className="orchestrate-layout">
        <section className="orchestrate-composer">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">
                <Sparkles size={12} /> Intent to outcome
              </span>
              <h2>Compose a task</h2>
            </div>
          </div>

          {!native && (
            <div className="inline-notice" style={{ marginBottom: "1.25rem" }}>
              <AlertTriangle size={14} />
              <span>Task orchestration and agent dispatch are available in the installed Whim Windows app.</span>
            </div>
          )}

          <label className="field">
            <span>Intent</span>
            <textarea
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              placeholder="Describe what you want Whim to build, verify, or ship."
              rows={4}
              disabled={!native}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Mode</span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as OrchestrationJobMode)}
                disabled={!native}
              >
                {JOB_MODES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Provider</span>
              <input
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                placeholder="auto"
                disabled={!native}
              />
            </label>
            <label className="field">
              <span>Model</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="provider default"
                disabled={!native}
              />
            </label>
          </div>

          <details className="credentials-details">
            <summary>Provider credentials (session only)</summary>
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
                disabled={!native}
              />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://localhost:11434"
                disabled={!native}
              />
            </label>
          </details>

          <button
            className="primary-action"
            type="button"
            onClick={() => void createJob()}
            disabled={creating || !intent.trim() || !native}
          >
            {creating ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Create task
          </button>
        </section>

        <section className="orchestrate-board">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">
                <ListChecks size={12} /> Task board
              </span>
              <h2>Active tasks</h2>
            </div>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void refreshJobs()}
              disabled={!native}
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          {jobs.length === 0 ? (
            <p className="palette-empty">
              No tasks yet. Compose an intent and create a task to begin.
            </p>
          ) : (
            <ul className="orchestrate-list">
              {jobs.map((job) => {
                const tone = STATUS_TONE[job.status];
                const actions = availableActions(job.status);
                const isSelected = job.id === selectedJobId;
                return (
                  <li
                    key={job.id}
                    className={`orchestrate-card ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <div className="orchestrate-card-head">
                      <strong>{job.title}</strong>
                      <span className={`status-pill ${tone}`}>{STATUS_LABEL[job.status]}</span>
                    </div>
                    <div className="orchestrate-card-meta">
                      <span>
                        <ShieldCheck size={11} /> {job.risk} risk
                      </span>
                      <span>
                        <BarChart3 size={11} /> {evidenceSummary(job)}
                      </span>
                      <span className="mode-tag">{job.mode}</span>
                    </div>
                    {isSelected && (
                      <div
                        className="orchestrate-card-actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {job.status === "queued" && (
                          <button
                            className="primary-action"
                            type="button"
                            onClick={() => void dispatchJob(job.id)}
                            disabled={dispatching || !native}
                          >
                            {dispatching ? (
                              <LoaderCircle className="spin" size={13} />
                            ) : (
                              <Rocket size={13} />
                            )}{" "}
                            Dispatch
                          </button>
                        )}
                        {actions.includes("pause") && (
                          <button
                            className="secondary-action"
                            type="button"
                            onClick={() => void transitionJob(job.id, "pause")}
                            disabled={!native}
                          >
                            <PauseCircle size={13} /> Pause
                          </button>
                        )}
                        {actions.includes("resume") && (
                          <button
                            className="secondary-action"
                            type="button"
                            onClick={() => void transitionJob(job.id, "resume")}
                            disabled={!native}
                          >
                            <PlayCircle size={13} /> Resume
                          </button>
                        )}
                        {actions.includes("retry") && (
                          <button
                            className="secondary-action"
                            type="button"
                            onClick={() => void retryJob(job.id)}
                            disabled={!native}
                          >
                            <RotateCcw size={13} /> Retry
                          </button>
                        )}
                        {actions.includes("cancel") && (
                          <button
                            className="ghost-action"
                            type="button"
                            onClick={() => void transitionJob(job.id, "cancel")}
                            disabled={!native}
                          >
                            <Square size={13} /> Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {selectedJob && (
        <section className="orchestrate-detail">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">
                <CircleDashed size={12} /> Task detail
              </span>
              <h2>{selectedJob.title}</h2>
            </div>
          </div>
          <p className="orchestrate-intent">{selectedJob.intent}</p>
          <div className="orchestrate-stats">
            <span>
              <CheckCircle2 size={12} /> Attempt {selectedJob.attempt}
            </span>
            <span>
              <CircleDashed size={12} /> {selectedJob.operationIds.length} operation(s)
            </span>
            {selectedJob.summary && (
              <span className="summary">
                <AlertTriangle size={12} /> {selectedJob.summary}
              </span>
            )}
          </div>
        </section>
      )}

      {toast && (
        <div className="toast">
          <span>
            <Sparkles size={13} />
          </span>
          {toast}
        </div>
      )}
    </main>
  );
}

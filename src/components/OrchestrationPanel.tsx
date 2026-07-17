import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  Cpu,
  FileCode2,
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
import { displayWorkflowMode } from "../lib/agent-workflow";

type OrchestrationPanelProps = { workspace: string; initialJobId?: string | null };

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

export function OrchestrationPanel({ workspace, initialJobId }: OrchestrationPanelProps) {
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
  const [indexManifest, setIndexManifest] = useState<string | null>(null);
  const [indexFileCount, setIndexFileCount] = useState(0);
  const [indexing, setIndexing] = useState(false);
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

  useEffect(() => {
    if (initialJobId) setSelectedJobId(initialJobId);
  }, [initialJobId]);

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

  const [providers, setProviders] = useState<{ provider: string; label: string; kind: string; available: boolean; hasKey: boolean }[]>([]);
  useEffect(() => {
    if (!native) return;
    const discover = async () => {
      try {
        const all = await bridge.discoverProviders();
        setProviders(all.map((p) => ({ provider: p.provider, label: p.label, kind: p.kind, available: p.available, hasKey: p.hasKey })));
      } catch { /* ignore */ }
    };
    void discover();
    const timer = window.setInterval(discover, 10_000);
    return () => window.clearInterval(timer);
  }, [native]);

  const generateIndex = useCallback(async () => {
    if (!native || indexing) return;
    setIndexing(true);
    try {
      const manifest = await bridge.indexCodebase(workspace);
      setIndexManifest(manifest);
      const match = manifest.match(/(\d+) files/);
      if (match) setIndexFileCount(Number(match[1]));
      showToast("Codebase index generated.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not index codebase.");
    } finally {
      setIndexing(false);
    }
  }, [native, indexing, workspace, showToast]);

  const dispatchMultiAgent = async () => {
    if (!native || !intent.trim() || dispatching) return;
    setDispatching(true);
    try {
      const job = await bridge.dispatchMultiAgentJob({
        workspace,
        intent: intent.trim(),
        title: intent.trim().slice(0, 60),
        apiKey: apiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      setSelectedJobId(job.id);
      showToast("Multi-agent task dispatched across available providers.");
      await refreshJobs();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not dispatch multi-agent task.");
    } finally {
      setDispatching(false);
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

          <div className="action-row">
            <button
              className="primary-action"
              type="button"
              onClick={() => void createJob()}
              disabled={creating || !intent.trim() || !native}
            >
              {creating ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Create task
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void dispatchMultiAgent()}
              disabled={dispatching || !intent.trim() || !native}
              title="Decompose and run across all available providers in parallel"
            >
              {dispatching ? <LoaderCircle className="spin" size={15} /> : <Cpu size={15} />} Multi-agent run
            </button>
          </div>
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
                const actions = availableActions(job.status);
                const isSelected = job.id === selectedJobId;
                return (
                  <li
                    key={job.id}
                    className={`orchestrate-item ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <span className={`task-status ${job.status}`}>{STATUS_LABEL[job.status]}</span>
                    <div className="orchestrate-item-head">
                      <strong>{job.title}</strong>
                      <div className="orchestrate-item-meta">
                        <span>{displayWorkflowMode(job.mode)}</span>
                        <span><ShieldCheck size={10} /> {job.risk} risk</span>
                        <span><BarChart3 size={10} /> {evidenceSummary(job)}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <div
                        className="orchestrate-item-actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {job.status === "queued" && (
                          <button
                            type="button"
                            title="Dispatch"
                            onClick={() => void dispatchJob(job.id)}
                            disabled={dispatching || !native}
                          >
                            {dispatching ? <LoaderCircle className="spin" size={12} /> : <Rocket size={12} />}
                          </button>
                        )}
                        {actions.includes("pause") && (
                          <button type="button" title="Pause" onClick={() => void transitionJob(job.id, "pause")} disabled={!native}>
                            <PauseCircle size={12} />
                          </button>
                        )}
                        {actions.includes("resume") && (
                          <button type="button" title="Resume" onClick={() => void transitionJob(job.id, "resume")} disabled={!native}>
                            <PlayCircle size={12} />
                          </button>
                        )}
                        {actions.includes("retry") && (
                          <button type="button" title="Retry" onClick={() => void retryJob(job.id)} disabled={!native}>
                            <RotateCcw size={12} />
                          </button>
                        )}
                        {actions.includes("cancel") && (
                          <button type="button" title="Cancel" onClick={() => void transitionJob(job.id, "cancel")} disabled={!native}>
                            <Square size={12} />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="orchestrate-detail" onClick={(event) => event.stopPropagation()}>
                      <p className="orchestrate-intent">{job.intent}</p>
                      <div className="orchestrate-stats">
                        <span>
                          <CheckCircle2 size={11} /> Attempt {job.attempt}
                        </span>
                        <span>
                          <CircleDashed size={11} /> {job.operationIds.length} operation(s)
                        </span>
                        {job.summary && (
                          <span className="summary">
                            <AlertTriangle size={11} /> {job.summary}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="provider-pool-section">
          <div className="section-heading-row">
            <div>
              <span className="section-kicker">
                <Cpu size={12} /> Provider pool
              </span>
              <h2>Available providers</h2>
            </div>
            <button
              className="secondary-action"
              type="button"
              onClick={async () => {
                try {
                  const all = await bridge.discoverProviders();
                  setProviders(all.map((p) => ({ provider: p.provider, label: p.label, kind: p.kind, available: p.available, hasKey: p.hasKey })));
                } catch { /* ignore */ }
              }}
              disabled={!native}
            >
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="provider-pool-grid">
            {providers.map((p) => (
              <div
                key={p.provider}
                className={`provider-pool-card ${p.available ? "available" : "unavailable"} ${p.kind}`}
              >
                <span className={`pool-dot ${p.hasKey ? "key-set" : "no-key"}`} />
                <span className="pool-label">{p.label}</span>
                <span className="pool-status">
                  {p.available ? (p.hasKey ? "Ready" : "No key") : "Offline"}
                </span>
                <span className="pool-kind">{p.kind}</span>
              </div>
            ))}
          </div>
        </section>

        <details className="codebase-index-section">
          <summary className="section-heading-row" style={{ cursor: "pointer" }}>
            <div>
              <span className="section-kicker">
                <FileCode2 size={12} /> Codebase index
              </span>
              <h2>
                {indexManifest
                  ? `${indexFileCount} files indexed`
                  : "Index workspace for agent context"}
              </h2>
            </div>
          </summary>
          {indexManifest && (
            <pre className="codebase-manifest">{indexManifest}</pre>
          )}
          <div className="action-row" style={{ marginTop: "8px" }}>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void generateIndex()}
              disabled={indexing || !native}
            >
              {indexing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              {indexManifest ? "Re-index" : "Generate index"}
            </button>
            {indexManifest && (
              <button
                className="secondary-action"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(indexManifest);
                    showToast("Manifest copied to clipboard.");
                  } catch { /* ignore */ }
                }}
              >
                <Rocket size={14} /> Copy manifest
              </button>
            )}
          </div>
        </details>
      </div>

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

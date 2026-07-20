import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  FileDiff,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Rocket,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { deployAdapters } from "../data/product";
import { bridge, type NativeResult } from "../lib/bridge";

type ShipHubProps = { workspace: string };
type PreflightStatus = "idle" | "checking" | "ready" | "blocked";
type DeployStatus = "idle" | "running" | "success" | "error";
type AuxiliaryAction = "diff" | "history" | null;
type LogLevel = "info" | "success" | "warning" | "error";
type LogEntry = { id: number; level: LogLevel; text: string };

const supportedAdapters = deployAdapters.filter(
  (adapter) => adapter.id !== "azure" && adapter.id !== "windows",
);
const previewTargets = new Set(["vercel", "netlify", "cloudflare", "railway"]);

function workspaceName(workspace: string) {
  return workspace.split(/[\\/]/).filter(Boolean).pop() ?? "untitled";
}

function classifyOutput(text: string, fallback: LogLevel): LogLevel {
  const normalized = text.toLowerCase();
  if (/\b(error|failed|fatal)\b|cannot\s/.test(normalized)) return "error";
  if (/\b(warn|warning|unsupported|missing)\b|not found|requires\s|no provider-specific/.test(normalized)) return "warning";
  return fallback;
}

export function ShipHub({ workspace }: ShipHubProps) {
  const native = bridge.isNative();
  const [target, setTarget] = useState("vercel");
  const [preflightStatus, setPreflightStatus] = useState<PreflightStatus>("idle");
  const [deployStatus, setDeployStatus] = useState<DeployStatus>("idle");
  const [checkedTarget, setCheckedTarget] = useState<string | null>(null);
  const [auxiliaryAction, setAuxiliaryAction] = useState<AuxiliaryAction>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const nextLogId = useRef(1);

  const selected = useMemo(
    () => supportedAdapters.find((adapter) => adapter.id === target) ?? supportedAdapters[0],
    [target],
  );
  const projectName = workspaceName(workspace);
  const supportsPreview = previewTargets.has(target);
  const supportsProduction = target !== "docker";
  const isLocal = target === "docker";
  const checking = preflightStatus === "checking";
  const deploying = deployStatus === "running";
  const busy = checking || deploying || auxiliaryAction !== null;
  const ready = preflightStatus === "ready" && checkedTarget === target;

  const appendLogs = (entries: Array<Omit<LogEntry, "id">>) => {
    setLogs((current) => [
      ...current,
      ...entries.map((entry) => ({ ...entry, id: nextLogId.current++ })),
    ]);
  };

  const appendResult = (
    result: NativeResult,
    successMessage: string,
    failureMessage: string,
  ) => {
    const entries: Array<Omit<LogEntry, "id">> = [];
    const seen = new Set<string>();
    const addLine = (text: string, level: LogLevel) => {
      const trimmed = text.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      entries.push({ level: classifyOutput(trimmed, level), text: trimmed });
    };

    result.stdout?.split(/\r?\n/).forEach((line) => addLine(line, "info"));
    result.message?.split(";").forEach((line) => addLine(line, result.success ? "info" : "warning"));
    result.stderr?.split(/\r?\n/).forEach((line) => addLine(line, "error"));
    entries.push({
      level: result.success ? "success" : "error",
      text: result.success ? successMessage : failureMessage,
    });
    appendLogs(entries);
  };

  const selectTarget = (nextTarget: string) => {
    if (nextTarget === target || busy || !native) return;
    const adapter = supportedAdapters.find((item) => item.id === nextTarget);
    setTarget(nextTarget);
    setCheckedTarget(null);
    setPreflightStatus("idle");
    setDeployStatus("idle");
    appendLogs([{ level: "info", text: `Selected ${adapter?.name ?? nextTarget}. Run preflight before deploying.` }]);
  };

  const preflight = async () => {
    if (busy || !native) return;
    const targetAtStart = target;
    const nameAtStart = selected.name;
    const mode = isLocal ? "local" : supportsPreview ? "preview" : "production";
    setPreflightStatus("checking");
    setDeployStatus("idle");
    setCheckedTarget(null);
    appendLogs([{ level: "info", text: `Starting ${mode} preflight for ${nameAtStart}.` }]);

    try {
      const result = await bridge.deployPreflight(workspace, targetAtStart);
      appendResult(
        result,
        `${nameAtStart} ${mode} preflight passed.`,
        `${nameAtStart} ${mode} preflight is blocked. Resolve the reported items and recheck.`,
      );
      setCheckedTarget(targetAtStart);
      setPreflightStatus(result.success ? "ready" : "blocked");
    } catch (error) {
      appendLogs([{
        level: "error",
        text: error instanceof Error ? error.message : `${nameAtStart} preflight failed to run.`,
      }]);
      setCheckedTarget(targetAtStart);
      setPreflightStatus("blocked");
    }
  };

  const deploy = async (production: boolean) => {
    if (!ready || busy || !native) return;
    if (production) {
      const confirmed = window.confirm(
        `Deploy ${projectName} to production on ${selected.name}?\n\nThis can create public infrastructure, consume billing, and replace the current production release.`,
      );
      if (!confirmed) {
        appendLogs([{ level: "info", text: `${selected.name} production deployment cancelled.` }]);
        return;
      }
    }

    const mode = isLocal ? "local" : production ? "production" : "preview";
    setDeployStatus("running");
    appendLogs([{ level: "info", text: `Starting ${selected.name} ${mode} deployment.` }]);
    try {
      const result = await bridge.deploy(workspace, target, production, production);
      appendResult(
        result,
        `${selected.name} ${mode} deployment completed successfully.`,
        `${selected.name} ${mode} deployment failed.`,
      );
      setDeployStatus(result.success ? "success" : "error");
    } catch (error) {
      appendLogs([{
        level: "error",
        text: error instanceof Error ? error.message : `${selected.name} ${mode} deployment failed.`,
      }]);
      setDeployStatus("error");
    }
  };

  const runGitCommand = async (
    action: Exclude<AuxiliaryAction, null>,
    title: string,
    command: string,
    emptyMessage: string,
  ) => {
    if (busy || !native) return;
    setAuxiliaryAction(action);
    appendLogs([{ level: "info", text: `Loading ${title.toLowerCase()} from ${projectName}.` }]);
    try {
      const result = await bridge.runCommand(workspace, command);
      const hasOutput = Boolean(result.stdout?.trim() || result.message?.trim());
      appendResult(
        result,
        hasOutput ? `${title} loaded.` : emptyMessage,
        `${title} could not be loaded.`,
      );
    } catch (error) {
      appendLogs([{
        level: "error",
        text: error instanceof Error ? error.message : `${title} could not be loaded.`,
      }]);
    } finally {
      setAuxiliaryAction(null);
    }
  };

  const reviewDiff = () => runGitCommand(
    "diff",
    "Release diff",
    "git diff --stat HEAD -- .",
    "No tracked changes were reported against HEAD.",
  );
  const releaseHistory = () => runGitCommand(
    "history",
    "Release history",
    "git log --oneline --decorate -n 12",
    "No Git release history was reported.",
  );

  // ─── Operations monitor: live previews, health, and rollback ──────────────
  type HealthState = "unknown" | "checking" | "healthy" | "unhealthy";
  type Endpoint = {
    id: string;
    label: string;
    url: string;
    health: HealthState;
    detail?: string;
  };
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [healthUrl, setHealthUrl] = useState("http://127.0.0.1:3000");
  const [rollingBack, setRollingBack] = useState(false);

  const addEndpoint = (label: string, url: string) => {
    setEndpoints((current) =>
      current.some((entry) => entry.url === url)
        ? current
        : [...current, { id: crypto.randomUUID(), label, url, health: "unknown" }],
    );
  };

  const startPreview = async () => {
    if (busy || !native) return;
    appendLogs([{ level: "info", text: "Starting local preview on port 3000." }]);
    try {
      const result = await bridge.startLocalPreview(3000);
      appendResult(result, "Local preview started on http://127.0.0.1:3000.", "Local preview failed to start.");
      if (result.success) addEndpoint("Local preview", "http://127.0.0.1:3000");
    } catch (error) {
      appendLogs([{ level: "error", text: error instanceof Error ? error.message : "Local preview failed to start." }]);
    }
  };

  const startTunnel = async () => {
    if (busy || !native) return;
    appendLogs([{ level: "info", text: "Opening a public tunnel on port 3000." }]);
    try {
      const result = await bridge.startTunnel(3000);
      appendResult(result, "Tunnel process started. Copy the public URL from the readiness stream to monitor it.", "Tunnel failed to start.");
    } catch (error) {
      appendLogs([{ level: "error", text: error instanceof Error ? error.message : "Tunnel failed to start." }]);
    }
  };

  const checkHealth = async (url: string) => {
    const id = endpoints.find((entry) => entry.url === url)?.id;
    if (id) setEndpoints((current) => current.map((entry) => entry.url === url ? { ...entry, health: "checking" } : entry));
    try {
      const report = await bridge.deploymentHealth(url);
      const health: HealthState = report.reachable ? "healthy" : "unhealthy";
      const detail = report.status ? `HTTP ${report.status} · ${report.latencyMs ?? 0}ms` : (report.error ?? "Unreachable");
      setEndpoints((current) => current.map((entry) => entry.url === url ? { ...entry, health, detail } : entry));
    } catch (error) {
      setEndpoints((current) => current.map((entry) => entry.url === url ? { ...entry, health: "unhealthy", detail: error instanceof Error ? error.message : "Check failed" } : entry));
    }
  };

  const rollback = async () => {
    if (rollingBack || !native) return;
    const confirmed = window.confirm(
      `Roll back ${projectName} to the last Whim checkpoint?\n\nTracked changes since the checkpoint are stashed and the workspace is restored to the checkpoint commit.`,
    );
    if (!confirmed) {
      appendLogs([{ level: "info", text: "Rollback cancelled." }]);
      return;
    }
    setRollingBack(true);
    appendLogs([{ level: "info", text: "Rolling back to the last checkpoint." }]);
    try {
      const result = await bridge.workspaceRollback(workspace);
      appendLogs([
        { level: "info", text: `Restored commit: ${result.restoredCommit || "checkpoint"}` },
        { level: result.stashCreated ? "warning" : "info", text: result.stashCreated ? "Working changes stashed as whim-rollback-tracked." : "No working changes were stashed." },
      ]);
    } catch (error) {
      appendLogs([{ level: "error", text: error instanceof Error ? error.message : "Rollback failed." }]);
    } finally {
      setRollingBack(false);
    }
  };

  const preflightLabel = preflightStatus === "idle"
    ? "Not checked"
    : preflightStatus === "checking"
      ? "Checking"
      : preflightStatus === "ready"
        ? "Ready"
        : "Blocked";
  const preflightDescription = preflightStatus === "idle"
    ? "Run a provider preflight before deployment."
    : preflightStatus === "checking"
      ? "Inspecting the selected adapter and project configuration."
      : preflightStatus === "ready"
        ? "The selected target passed its native preflight."
        : "Review the readiness stream for required fixes.";
  const prepareLabel = isLocal
    ? "Check local Docker run"
    : supportsPreview
      ? "Prepare private preview"
      : "Run production preflight";

  return (
    <main className="hub-page ship-page">
      {!native && (
        <div className="inline-notice" style={{ margin: "1.5rem 1.5rem 0 1.5rem" }}>
          <ShieldCheck size={14} />
          <span>Workspace deployment and preflight checks are available in the installed Whim Windows app.</span>
        </div>
      )}
      <section className="market-toolbar" style={{ justifyContent: "flex-end" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="primary-action" onClick={preflight} disabled={busy || !native} type="button">
            {checking ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} {prepareLabel}
          </button>
          <button className="secondary-action" type="button" onClick={reviewDiff} disabled={busy || !native}>
            {auxiliaryAction === "diff" ? <LoaderCircle className="spin" size={14} /> : <FileDiff size={14} />} Review release diff
          </button>
        </div>
      </section>

        <div className="release-card">
          <div className="release-card-head">
            <div>
              {checking ? <LoaderCircle className="spin" size={12} /> : ready ? <CheckCircle2 size={12} /> : preflightStatus === "blocked" ? <LockKeyhole size={11} /> : <Circle size={9} />}
              <span>Native deployment state</span>
            </div>
            <em>{projectName} · {selected.name}</em>
          </div>
          <div className="release-score">
            <div><strong>{preflightLabel}</strong></div>
            <p>{preflightDescription}</p>
          </div>
          <div className="release-gates">
            <span className={ready ? "passed" : "pending"}>
              {checking ? <LoaderCircle className="spin" size={12} /> : ready ? <Check size={12} /> : <Clock3 size={12} />} Preflight: {preflightLabel}
            </span>
            <span className={deployStatus === "success" ? "passed" : "pending"}>
              {deploying ? <LoaderCircle className="spin" size={12} /> : deployStatus === "success" ? <Check size={12} /> : <Clock3 size={12} />} Deploy: {deployStatus}
            </span>
          </div>
          <div className="release-target">
            <span className="target-logo" style={{ "--target-color": selected.color } as React.CSSProperties}><selected.icon size={17} /></span>
            <div><small>{isLocal ? "Local target" : supportsPreview ? "Preview target" : "Production target"}</small><strong>{selected.name}</strong></div>
            <button type="button" onClick={() => document.getElementById("ship-targets")?.scrollIntoView({ behavior: "smooth", block: "center" })} disabled={!native}>Change <ChevronRight size={12} /></button>
          </div>
        </div>

      <div className="ship-layout" style={{ marginTop: 30 }}>
        <section className="ship-targets" id="ship-targets">
          <div className="section-heading-row">
            <div><span className="section-kicker">Deploy adapters</span><h2>Ship anywhere supported</h2></div>
            <span className="portable-badge"><ShieldCheck size={12} /> native preflight required</span>
          </div>
          <div className="target-grid">
            {supportedAdapters.map((adapter) => {
              const Icon = adapter.icon;
              return (
                <button
                  className={`target-card ${target === adapter.id ? "selected" : ""}`}
                  type="button"
                  key={adapter.id}
                  onClick={() => selectTarget(adapter.id)}
                  disabled={busy || !native}
                >
                  <span className="target-icon" style={{ "--target-color": adapter.color } as React.CSSProperties}><Icon size={17} /></span>
                  <span><strong>{adapter.name}</strong><small>{adapter.description}</small></span>
                  {target === adapter.id && <CheckCircle2 size={15} />}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="release-console">
          <div className="console-head">
            <span><TerminalSquare size={14} /> Command-backed readiness stream</span>
            <div><button type="button" onClick={() => setLogs([])} disabled={!native}>Clear</button></div>
          </div>
          <div className="console-body">
            {logs.length === 0 ? (
              <span className="empty-log">No commands have run. Select a target and run preflight.</span>
            ) : logs.map((entry, index) => (
              <div className={entry.level === "success" ? "log-pass" : entry.level === "warning" || entry.level === "error" ? "log-warn" : ""} key={entry.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <code>{entry.level === "success" ? "✓ " : entry.level === "warning" ? "Warning: " : entry.level === "error" ? "Error: " : ""}{entry.text}</code>
              </div>
            ))}
            {checking && <div className="log-running"><span>··</span><code><LoaderCircle className="spin" size={11} /> Running {selected.name} preflight</code></div>}
            {deploying && <div className="log-running"><span>··</span><code><LoaderCircle className="spin" size={11} /> Running {selected.name} deployment</code></div>}
            {auxiliaryAction && <div className="log-running"><span>··</span><code><LoaderCircle className="spin" size={11} /> Running Git {auxiliaryAction === "diff" ? "diff" : "log"}</code></div>}
          </div>
          <div className="console-actions">
            <button type="button" onClick={preflight} disabled={busy || !native}><RefreshCw size={13} /> Recheck</button>
            {supportsPreview && (
              <button className="preview-deploy" type="button" onClick={() => deploy(false)} disabled={!ready || busy || !native}>
                <Rocket size={13} /> Deploy preview
              </button>
            )}
            {isLocal && (
              <button className="preview-deploy" type="button" onClick={() => deploy(false)} disabled={!ready || busy || !native}>
                <Rocket size={13} /> Run locally
              </button>
            )}
          </div>
        </aside>
      </div>

      <section className="ops-monitor">
        <div className="section-heading-row">
          <div><span className="section-kicker">Operations</span><h2>Monitor, health, and rollback</h2></div>
          <span className="portable-badge"><ShieldCheck size={12} /> native runtime required</span>
        </div>
        <div className="ops-actions">
          <button type="button" className="secondary-action" onClick={startPreview} disabled={busy || !native}><Rocket size={13} /> Start local preview</button>
          <button type="button" className="secondary-action" onClick={startTunnel} disabled={busy || !native}><ArrowRight size={13} /> Open tunnel</button>
          <button type="button" className="secondary-action" onClick={rollback} disabled={rollingBack || !native}><RotateCcw size={13} /> Rollback to checkpoint</button>
        </div>
        <div className="ops-health-row">
          <input
            type="text"
            className="ops-health-input"
            value={healthUrl}
            onChange={(event) => setHealthUrl(event.target.value)}
            placeholder="http://127.0.0.1:3000"
            aria-label="Endpoint URL to health check"
          />
          <button type="button" className="secondary-action" onClick={() => void checkHealth(healthUrl)} disabled={!native || !/^https?:\/\//.test(healthUrl.trim())}>{checking ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />} Check health</button>
          <button type="button" className="secondary-action" onClick={() => addEndpoint("Custom endpoint", healthUrl.trim())} disabled={!native || !/^https?:\/\//.test(healthUrl.trim())}><Check size={13} /> Monitor</button>
        </div>
        {endpoints.length > 0 && (
          <ul className="ops-endpoint-list">
            {endpoints.map((endpoint) => (
              <li key={endpoint.id} className={`ops-endpoint ops-${endpoint.health}`}>
                <span className="ops-endpoint-dot" aria-hidden="true" />
                <div className="ops-endpoint-meta">
                  <strong>{endpoint.label}</strong>
                  <code>{endpoint.url}</code>
                  <small>{endpoint.health === "unknown" ? "Not checked" : endpoint.detail ?? ""}</small>
                </div>
                <div className="ops-endpoint-actions">
                  <button type="button" onClick={() => void checkHealth(endpoint.url)} disabled={!native}><RefreshCw size={12} /> Health</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="production-guard">
        <span className="guard-icon"><ShieldCheck size={18} /></span>
        <div>
          <strong>{supportsProduction ? "Production requires explicit confirmation." : "This adapter runs locally."}</strong>
          <p>{supportsProduction ? "The production command runs only after preflight passes and you confirm the target in a native prompt." : "Docker is invoked in local mode; no production deployment action is exposed for this target."}</p>
        </div>
        <div className="guard-actions">
          <button type="button" onClick={releaseHistory} disabled={busy || !native}>
            {auxiliaryAction === "history" ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />} Release history
          </button>
          {supportsProduction ? (
            <button type="button" onClick={() => deploy(true)} disabled={!ready || busy || !native}>
              Deploy to production <ArrowRight size={13} />
            </button>
          ) : (
            <button type="button" disabled><LockKeyhole size={13} /> Local-only adapter</button>
          )}
        </div>
      </section>
    </main>
  );
}

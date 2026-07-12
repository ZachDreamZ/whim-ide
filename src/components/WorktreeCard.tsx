import { GitBranch, GitCompareArrows, GitFork, LoaderCircle, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, errorMessage, type GitWorktree, type WorktreeCandidateReport } from "../lib/bridge";

type WorktreeCardProps = {
  native: boolean;
  workspace: string | null;
  executionWorkspace: string | null;
  running?: boolean;
  onExecutionWorkspaceChange: (workspace: string) => void;
};

function samePath(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.replace(/\\/g, "/").toLowerCase() === right.replace(/\\/g, "/").toLowerCase());
}

function shortPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

/**
 * A deliberately small worktree controller. It only surfaces Git's actual
 * registered worktrees and creates new isolated branches under Whim's managed
 * sibling folder; it never pretends browser preview can isolate an agent.
 */
export function WorktreeCard({
  native,
  workspace,
  executionWorkspace,
  running = false,
  onExecutionWorkspaceChange,
}: WorktreeCardProps) {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<WorktreeCandidateReport | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const requestId = useRef(0);
  const targetRef = useRef(executionWorkspace);
  targetRef.current = executionWorkspace;

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    if (!native || !workspace) {
      setWorktrees([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const next = await bridge.listGitWorktrees();
      if (request !== requestId.current) return;
      setWorktrees(next);
      setError(null);
      if (report && !next.some((item) => samePath(item.path, report.candidateWorkspace))) setReport(null);
      const active = targetRef.current;
      const stillRegistered = active && (samePath(active, workspace) || next.some((item) => samePath(item.path, active)));
      if (!stillRegistered) onExecutionWorkspaceChange(workspace);
    } catch (cause) {
      if (request !== requestId.current) return;
      setWorktrees([]);
      setError(errorMessage(cause));
      if (!samePath(targetRef.current, workspace)) onExecutionWorkspaceChange(workspace);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [native, onExecutionWorkspaceChange, report, workspace]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating || running) return;
    setCreating(true);
    setError(null);
    try {
      const created = await bridge.createGitWorktree({ name: trimmed });
      setName("");
      setReport(null);
      onExecutionWorkspaceChange(created.path);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  const options = workspace
    ? [
      { path: workspace, label: "Selected workspace", detail: "current" },
      ...worktrees
        .filter((item) => !samePath(item.path, workspace))
        .map((item) => ({
          path: item.path,
          label: item.branch || (item.detached ? "Detached worktree" : "Git worktree"),
          detail: item.managed ? "Whim isolated" : "Git registered",
        })),
    ]
    : [];
  const activePath = executionWorkspace && options.some((option) => samePath(option.path, executionWorkspace))
    ? executionWorkspace
    : workspace ?? "";
  const activeCandidate = worktrees.find((item) => samePath(item.path, activePath) && !item.primary);

  const inspect = async () => {
    if (!activeCandidate || inspecting) return;
    setInspecting(true);
    setError(null);
    try {
      setReport(await bridge.inspectWorktreeCandidate(activeCandidate.path));
    } catch (cause) {
      setReport(null);
      setError(errorMessage(cause));
    } finally {
      setInspecting(false);
    }
  };

  return (
    <section className="worktree-card" aria-label="Isolated Git worktree">
      <div className="worktree-heading">
        <span><GitFork size={12} /> Execution workspace <small>{native ? "Git" : "Windows app"}</small></span>
        <button type="button" onClick={() => void refresh()} title="Refresh Git worktrees" aria-label="Refresh Git worktrees" disabled={!native || !workspace || loading || creating}>
          <RefreshCw className={loading ? "spin" : ""} size={12} />
        </button>
      </div>

      {!native ? (
        <div className="worktree-notice"><ShieldCheck size={11} /> Isolated execution is available in the installed Windows app.</div>
      ) : !workspace ? (
        <div className="worktree-notice"><GitBranch size={11} /> Open a Git project to create an isolated agent workspace.</div>
      ) : error ? (
        <div className="worktree-notice worktree-error"><GitBranch size={11} /> {error}</div>
      ) : (
        <>
          <label className="worktree-select-label">
            <span>Runs and task history are pinned to this folder.</span>
            <select value={activePath} onChange={(event) => { setReport(null); onExecutionWorkspaceChange(event.target.value); }} disabled={running || creating || loading}>
              {options.map((option) => <option key={option.path} value={option.path}>{option.label} · {option.detail} · {shortPath(option.path)}</option>)}
            </select>
          </label>
          <div className="worktree-create">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(); } }}
              placeholder="new isolated branch"
              aria-label="New isolated worktree name"
              disabled={running || creating || loading}
              maxLength={64}
            />
            <button type="button" onClick={() => void create()} disabled={!name.trim() || running || creating || loading} title="Create isolated Git worktree" aria-label="Create isolated Git worktree">
              {creating ? <LoaderCircle className="spin" size={11} /> : <Plus size={11} />} Create
            </button>
          </div>
          <small className="worktree-footnote">Creates a real branch and Git worktree; no files are copied into the current branch.</small>
          {activeCandidate && (
            <button className="candidate-inspect" type="button" onClick={() => void inspect()} disabled={running || inspecting || creating || loading}>
              {inspecting ? <LoaderCircle className="spin" size={11} /> : <GitCompareArrows size={11} />} {inspecting ? "Inspecting…" : "Inspect candidate"}
            </button>
          )}
          {report && (
            <div className="candidate-report" aria-label="Candidate review report">
              <div><strong>{report.branch || "Detached candidate"}</strong><span className={`candidate-risk ${report.risk}`}>{report.risk} risk</span></div>
              <small>{report.committedChangeCount} committed · {report.workingChangeCount} working · {report.verificationChecks.length} checks found</small>
              {report.blockers.length > 0 && <ul>{report.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
              {report.riskSignals.length > 0 && <ul className="candidate-signals">{report.riskSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul>}
              {report.changes.length > 0 && <ol>{report.changes.slice(0, 5).map((change) => <li key={`${change.source}:${change.status}:${change.path}`}><span>{change.status}</span>{change.path}</li>)}</ol>}
              <small>Read-only snapshot · base {report.baseHead.slice(0, 8)} · candidate {report.candidateHead.slice(0, 8)}{report.changesTruncated ? " · list truncated" : ""}</small>
            </div>
          )}
        </>
      )}
    </section>
  );
}

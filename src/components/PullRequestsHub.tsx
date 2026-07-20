import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, GitBranch, GitPullRequest, LoaderCircle, LogIn, LogOut, MessageSquare, Plus, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { bridge, type PullRequestStatus } from "../lib/bridge";

type InboxFilter = "all" | "reviewing" | "authored";

export function PullRequestsHub({ workspace }: { workspace: string }) {
  const native = bridge.isNative();
  const [status, setStatus] = useState<PullRequestStatus | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectingError, setConnectingError] = useState<string | null>(null);
  const [mergePr, setMergePr] = useState<number | null>(null);
  const [commentPr, setCommentPr] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ title: "", body: "", head: "", base: "main", draft: false });
  const [createBusy, setCreateBusy] = useState(false);
  const [createResult, setCreateResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!native) return;
    setLoading(true);
    setError(null);
    try {
      setStatus(await bridge.pullRequestStatus(workspace));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load pull requests.");
    } finally {
      setLoading(false);
    }
  }, [native, workspace]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setConnectingError(null);
    try {
      const login = await bridge.githubConnect();
      setConnectingError(`Connected as ${login}`);
      void refresh();
    } catch (cause) {
      setConnectingError(cause instanceof Error ? cause.message : "GitHub connection failed.");
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const handleDisconnect = useCallback(async () => {
    try {
      await bridge.githubDisconnect();
      setStatus(null);
      void refresh();
    } catch {
      // ignore
    }
  }, [refresh]);

  const handleMerge = async (prNumber: number, method: string) => {
    setActionBusy(true);
    setActionError(null);
    try {
      const msg = await bridge.mergePullRequest(workspace, prNumber, method);
      setActionError(msg);
      setMergePr(null);
      void refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Merge failed.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleComment = async (prNumber: number) => {
    if (!commentText.trim()) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const msg = await bridge.commentOnPullRequest(workspace, prNumber, commentText.trim());
      setActionError(msg);
      setCommentPr(null);
      setCommentText("");
      void refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Comment failed.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreatePr = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createForm.title.trim() || !createForm.head.trim() || !createForm.base.trim()) return;
    setCreateBusy(true);
    setCreateResult(null);
    try {
      const result = await bridge.createPullRequest(workspace, {
        title: createForm.title.trim(),
        body: createForm.body.trim() || undefined,
        head: createForm.head.trim(),
        base: createForm.base.trim(),
        draft: createForm.draft,
      });
      setCreateResult(`PR #${result.number} created: ${result.url}`);
      setShowCreateForm(false);
      setCreateForm({ title: "", body: "", head: "", base: "main", draft: false });
      void refresh();
    } catch (cause) {
      setCreateResult(cause instanceof Error ? cause.message : "Failed to create PR.");
    } finally {
      setCreateBusy(false);
    }
  };

  const pulls = useMemo(() => (status?.pullRequests ?? []).filter((pr) => (filter === "all" || pr.relationship === filter) && `${pr.title} ${pr.repository} ${pr.author ?? ""}`.toLowerCase().includes(query.toLowerCase())), [filter, query, status?.pullRequests]);

  const row = (pr: NonNullable<PullRequestStatus>["pullRequests"][number]) => {
    const isMerging = mergePr === pr.number;
    const isCommenting = commentPr === pr.number;
    return (
      <li key={pr.url}>
        <div className="pr-state"><GitPullRequest size={17} /></div>
        <div><strong>{pr.title}</strong><p>{pr.repository} #{pr.number} · {pr.author ?? "unknown author"}{pr.updatedAt ? ` · updated ${new Date(pr.updatedAt).toLocaleString()}` : ""}</p></div>
        <span className={`status-pill ${pr.state.toLowerCase() === "open" ? "active" : "neutral"}`}>{pr.isDraft ? "Draft" : pr.state.toLowerCase()}</span>
        <div className="pr-actions">
          {pr.state.toLowerCase() === "open" && (
            <>
              <button type="button" className="pr-action-btn" onClick={() => setMergePr(isMerging ? null : pr.number)} disabled={actionBusy} title="Merge"><GitPullRequest size={13} /></button>
              <button type="button" className="pr-action-btn" onClick={() => { setCommentPr(isCommenting ? null : pr.number); setMergePr(null); }} disabled={actionBusy} title="Comment"><MessageSquare size={13} /></button>
            </>
          )}
          <button type="button" className="pr-action-btn" onClick={() => void bridge.openUrl(pr.url)} aria-label={`Open pull request ${pr.number}`} title="Open on GitHub"><ExternalLink size={14} /></button>
        </div>
        {isMerging && (
          <div className="pr-inline-action">
            <select className="pr-merge-select" defaultValue="merge" disabled={actionBusy}>
              <option value="merge">Create merge commit</option>
              <option value="squash">Squash and merge</option>
              <option value="rebase">Rebase and merge</option>
            </select>
            <button className="primary-action" type="button" onClick={(e) => {
              const method = (e.currentTarget.parentElement!.querySelector("select") as HTMLSelectElement).value;
              void handleMerge(pr.number, method);
            }} disabled={actionBusy}>
              {actionBusy ? <LoaderCircle className="spin" size={13} /> : null} Merge
            </button>
            <button className="secondary-action" type="button" onClick={() => setMergePr(null)} disabled={actionBusy}>Cancel</button>
          </div>
        )}
        {isCommenting && (
          <div className="pr-inline-action">
            <textarea className="pr-comment-input" rows={2} value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Write a comment..." disabled={actionBusy} />
            <button className="primary-action" type="button" onClick={() => void handleComment(pr.number)} disabled={actionBusy || !commentText.trim()}>
              {actionBusy ? <LoaderCircle className="spin" size={13} /> : <MessageSquare size={13} />} Comment
            </button>
            <button className="secondary-action" type="button" onClick={() => { setCommentPr(null); setCommentText(""); }} disabled={actionBusy}>Cancel</button>
          </div>
        )}
      </li>
    );
  };

  return <main className="hub-page integration-page" aria-label="Pull requests">
    <header className="integration-hero">
      <div>
        <span className="section-kicker"><GitPullRequest size={13} /> GitHub</span>
        <h1>Pull requests</h1>
        <p>Review and track work across GitHub{status?.accountLogin ? ` as ${status.accountLogin}` : ""}.</p>
      </div>
      <div className="integration-actions">
        {status?.githubAuthenticated ? (
          <>
            <button className="primary-action" type="button" onClick={() => { setShowCreateForm(!showCreateForm); setCreateResult(null); }} disabled={!native}>
              <Plus size={13} /> New PR
            </button>
            <button className="secondary-action" type="button" onClick={handleDisconnect} disabled={!native} title="Disconnect GitHub">
              <LogOut size={13} /> Disconnect
            </button>
          </>
        ) : (
          <button className="primary-action" type="button" onClick={handleConnect} disabled={!native || connecting}>
            {connecting ? <LoaderCircle className="spin" size={13} /> : <LogIn size={13} />}
            {connecting ? "Connecting…" : "Connect GitHub"}
          </button>
        )}
        <button className="secondary-action" type="button" onClick={() => void refresh()} disabled={!native || loading}>
          <RefreshCw className={loading ? "spin" : ""} size={13} /> Refresh
        </button>
      </div>
    </header>

    {connectingError && <div className="inline-notice">{connectingError}</div>}
    {actionError && <div className="inline-notice">{actionError}</div>}

    {showCreateForm && status?.githubAuthenticated && (
      <section className="integration-board full-width">
        <form className="pr-create-form" onSubmit={handleCreatePr}>
          <h3>Create pull request</h3>
          <label>Title <input required value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="PR title" disabled={createBusy} /></label>
          <label>Description <textarea rows={3} value={createForm.body} onChange={(e) => setCreateForm({ ...createForm, body: e.target.value })} placeholder="Optional description" disabled={createBusy} /></label>
          <div className="pr-create-fields">
            <label>Head branch <input required value={createForm.head} onChange={(e) => setCreateForm({ ...createForm, head: e.target.value })} placeholder="feature-branch" disabled={createBusy} /></label>
            <label>Base branch <input required value={createForm.base} onChange={(e) => setCreateForm({ ...createForm, base: e.target.value })} disabled={createBusy} /></label>
            <label className="pr-create-draft"><input type="checkbox" checked={createForm.draft} onChange={(e) => setCreateForm({ ...createForm, draft: e.target.checked })} disabled={createBusy} /> Draft PR</label>
          </div>
          <div className="pr-create-actions">
            <button className="primary-action" type="submit" disabled={createBusy || !createForm.title.trim() || !createForm.head.trim()}>
              {createBusy ? <LoaderCircle className="spin" size={13} /> : <GitPullRequest size={13} />} Create PR
            </button>
            <button className="secondary-action" type="button" onClick={() => setShowCreateForm(false)} disabled={createBusy}>Cancel</button>
          </div>
          {createResult && <p className="pr-create-result">{createResult}</p>}
        </form>
      </section>
    )}

    <section className="integration-board full-width">
      <div className="integration-toolbar">
        <label><Search size={14} /><input aria-label="Search pull requests" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pull requests" /></label>
        <div className="filter-pills" role="group" aria-label="Pull request view">
          {(["all","reviewing","authored"] as InboxFilter[]).map((item) => (
            <button className={filter === item ? "active" : ""} type="button" key={item} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>
          ))}
        </div>
      </div>

      <div className="repo-strip">
        <span><GitBranch size={14} /> {status?.branch || "No local branch"}</span>
        <span><ShieldCheck size={14} /> {status?.githubAuthenticated ? `GitHub${status.accountLogin ? ` (${status.accountLogin})` : ""}` : "Not connected"}</span>
        <span>{status?.remoteUrl ?? "No origin remote"}</span>
      </div>

      {(error || status?.message) && <div className="inline-notice"><span>{error ?? status?.message}</span></div>}

      {!status?.githubAuthenticated ? (
        <div className="integration-empty">
          <GitPullRequest size={28} />
          <strong>GitHub not connected</strong>
          <span>Click "Connect GitHub" above to sign in and view your pull requests.</span>
        </div>
      ) : pulls.length === 0 ? (
        <div className="integration-empty">
          <GitPullRequest size={28} />
          <strong>No pull requests to show</strong>
          <span>No pull requests match this inbox view.</span>
        </div>
      ) : (
        <ul className="pr-list">{pulls.map(row)}</ul>
      )}

      {(status?.previouslyReviewed.length ?? 0) > 0 && (
        <>
          <div className="section-heading-row reviewed-heading">
            <div><span className="section-kicker">History</span><h2>Previously reviewed</h2></div>
          </div>
          <ul className="pr-list previous">{status!.previouslyReviewed.slice(0, 20).map(row)}</ul>
        </>
      )}
    </section>
  </main>;
}

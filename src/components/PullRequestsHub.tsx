import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, GitBranch, GitPullRequest, LoaderCircle, LogIn, LogOut, RefreshCw, Search, ShieldCheck } from "lucide-react";
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

  const pulls = useMemo(() => (status?.pullRequests ?? []).filter((pr) => (filter === "all" || pr.relationship === filter) && `${pr.title} ${pr.repository} ${pr.author ?? ""}`.toLowerCase().includes(query.toLowerCase())), [filter, query, status?.pullRequests]);

  const row = (pr: NonNullable<PullRequestStatus>["pullRequests"][number]) => (
    <li key={pr.url}>
      <div className="pr-state"><GitPullRequest size={17} /></div>
      <div><strong>{pr.title}</strong><p>{pr.repository} #{pr.number} · {pr.author ?? "unknown author"}{pr.updatedAt ? ` · updated ${new Date(pr.updatedAt).toLocaleString()}` : ""}</p></div>
      <span className={`status-pill ${pr.state.toLowerCase() === "open" ? "active" : "neutral"}`}>{pr.isDraft ? "Draft" : pr.state.toLowerCase()}</span>
      <button type="button" onClick={() => void bridge.openUrl(pr.url)} aria-label={`Open pull request ${pr.number}`}><ExternalLink size={14} /></button>
    </li>
  );

  return <main className="hub-page integration-page" aria-label="Pull requests">
    <header className="integration-hero">
      <div>
        <span className="section-kicker"><GitPullRequest size={13} /> GitHub</span>
        <h1>Pull requests</h1>
        <p>Review and track work across GitHub{status?.accountLogin ? ` as ${status.accountLogin}` : ""}.</p>
      </div>
      <div className="integration-actions">
        {status?.githubAuthenticated ? (
          <button className="secondary-action" type="button" onClick={handleDisconnect} disabled={!native} title="Disconnect GitHub">
            <LogOut size={13} /> Disconnect
          </button>
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

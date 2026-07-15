import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, FileJson2, Globe2, PlugZap, RefreshCw, ShieldAlert } from "lucide-react";
import { bridge, type SitesStatus } from "../lib/bridge";

export function SitesHub({ workspace }: { workspace: string }) {
  const native = bridge.isNative();
  const [status, setStatus] = useState<SitesStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => { if (!native) return; try { setStatus(await bridge.sitesStatus(workspace)); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not inspect Sites."); } }, [native, workspace]);
  useEffect(() => { void refresh(); }, [refresh]);
  const openSites = async () => { try { await bridge.openGptSection("Sites"); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open Sites in GPT."); } };
  return <main className="hub-page integration-page" aria-label="Sites">
    <header className="integration-hero"><div><span className="section-kicker"><Globe2 size={13} /> Sites</span><h1>Sites</h1><p>Turn your ideas into live websites. Whim tracks this workspace’s real Sites metadata and hands creation, sharing, and deployment to the authenticated GPT Sites control plane.</p></div><div className="header-actions"><button className="secondary-action" type="button" onClick={() => void refresh()} disabled={!native}><RefreshCw size={13} /> Refresh</button><button className="primary-action" type="button" onClick={() => void openSites()} disabled={!native}><ExternalLink size={13} /> Create</button></div></header>
    {error && <div className="inline-notice"><span>{error}</span></div>}
    <div className="site-status-grid">
      <section className="site-status-card"><span className={status?.pluginInstalled ? "good" : "warn"}>{status?.pluginInstalled ? <CheckCircle2 size={20} /> : <PlugZap size={20} />}</span><div><small>Codex integration</small><h2>{status?.pluginInstalled ? "Sites plugin installed" : "Sites plugin not installed"}</h2><p>{status?.pluginInstalled ? `Version ${status.pluginVersion ?? "unknown"} is available to GPT and Codex.` : "Install the Sites plugin in the GPT app to enable build and deployment tools."}</p></div></section>
      <section className="site-status-card"><span className={status?.projectId ? "good" : "warn"}>{status?.configExists ? <FileJson2 size={20} /> : <ShieldAlert size={20} />}</span><div><small>Workspace binding</small><h2>{status?.projectId ? "Connected to a Site" : status?.configExists ? "Hosting config ready" : "Not connected to a Site"}</h2><p>{status?.configExists ? status.configPath : "Use Sites in GPT to create or save this project. It will write .openai/hosting.json here."}</p></div></section>
    </div>
    <section className="integration-board full-width site-details"><div className="section-heading-row"><div><span className="section-kicker">Workspace site</span><h2>Deployment details</h2></div><div className="header-actions">{status?.configExists && <button className="secondary-action" type="button" onClick={() => void bridge.reveal(status.configPath)}><FileJson2 size={13} /> Show config</button>}<button className="secondary-action" type="button" onClick={() => void openSites()}><ExternalLink size={13} /> Open Sites</button></div></div>
      {status?.configExists ? <dl className="detail-grid"><div><dt>Project ID</dt><dd>{status.projectId ?? "Not recorded"}</dd></div><div><dt>Site slug</dt><dd>{status.siteSlug ?? "Not recorded"}</dd></div><div><dt>Access</dt><dd>{status.access ?? "Not recorded"}</dd></div><div><dt>Build command</dt><dd>{status.buildCommand ?? "Managed by Sites"}</dd></div><div><dt>Output directory</dt><dd>{status.outputDirectory ?? "Managed by Sites"}</dd></div></dl> : <div className="integration-empty"><Globe2 size={28} /><strong>No Sites binding in this workspace</strong><span>Whim will never invent a project ID or deployment URL. Create or save the site through the installed Sites integration, then refresh.</span></div>}
    </section>
  </main>;
}

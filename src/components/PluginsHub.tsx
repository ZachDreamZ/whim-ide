import { useCallback, useEffect, useMemo, useState } from "react";
import { Blocks, ExternalLink, FileJson2, LoaderCircle, Plus, RefreshCw, Search, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { bridge, type CodexPlugin, type CodexPluginCatalog } from "../lib/bridge";

const emptyCatalog: CodexPluginCatalog = { installed: [], available: [] };

function PluginCard({ plugin, busy, onInstall, onRemove }: { plugin: CodexPlugin; busy: boolean; onInstall?: () => void; onRemove?: () => void }) {
  return <article className="plugin-card" style={{ "--plugin-color": plugin.brandColor ?? "#9c8cff" } as React.CSSProperties}>
    <div className="plugin-card-top"><span className="plugin-mark">{plugin.displayName.slice(0, 1).toUpperCase()}</span><span className={`status-pill ${plugin.installed ? "good" : "neutral"}`}>{plugin.installed ? "Installed" : plugin.marketplaceName || "Available"}</span></div>
    <h2>{plugin.displayName}</h2><p>{plugin.description || `Add ${plugin.displayName} capabilities to Codex and Whim.`}</p>
    <div className="plugin-meta"><span>{plugin.developerName}</span><span>v{plugin.version}</span>{plugin.category && <span>{plugin.category}</span>}</div>
    <div className="plugin-capabilities">{plugin.capabilities.map((item) => <span key={item}><ShieldCheck size={11} /> {item}</span>)}</div>
    <div className="plugin-actions">
      {!plugin.installed && onInstall && <button className="plugin-install" type="button" onClick={onInstall} disabled={busy}>{busy ? <LoaderCircle className="spin" size={13} /> : <Blocks size={13} />} Install</button>}
      {plugin.installed && plugin.manifestPath && <button type="button" onClick={() => void bridge.reveal(plugin.manifestPath)}><FileJson2 size={13} /> Manifest</button>}
      {plugin.websiteUrl && <button type="button" onClick={() => void bridge.openUrl(plugin.websiteUrl!)}><ExternalLink size={13} /> Website</button>}
      {plugin.installed && onRemove && <button type="button" onClick={onRemove} disabled={busy}><Trash2 size={13} /> Remove</button>}
    </div>
  </article>;
}

export function PluginsHub() {
  const native = bridge.isNative();
  const [catalog, setCatalog] = useState<CodexPluginCatalog>(emptyCatalog);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!native) return;
    try { setCatalog(await bridge.codexPluginCatalog()); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load the Codex plugin directory."); }
  }, [native]);
  useEffect(() => { void refresh(); }, [refresh]);

  const changeInstall = async (plugin: CodexPlugin, install: boolean) => {
    setBusyId(plugin.pluginId); setError(null);
    try {
      if (install) await bridge.installCodexPlugin(plugin.pluginId); else await bridge.removeCodexPlugin(plugin.pluginId);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Could not ${install ? "install" : "remove"} the plugin.`); }
    finally { setBusyId(null); }
  };

  const openPluginControl = async () => {
    try { await bridge.openGptSection("Plugins"); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open Plugins in GPT."); }
  };

  const matches = useCallback((plugin: CodexPlugin) => `${plugin.displayName} ${plugin.description} ${plugin.category ?? ""} ${plugin.marketplaceName}`.toLowerCase().includes(query.toLowerCase()), [query]);
  const installed = useMemo(() => catalog.installed.filter(matches), [catalog.installed, matches]);
  const available = useMemo(() => catalog.available.filter(matches).slice(0, query ? 120 : 24), [catalog.available, matches, query]);

  return <main className="hub-page integration-page" aria-label="Plugins">
    <header className="integration-hero"><div><span className="section-kicker"><Blocks size={13} /> Plugins</span><h1>Plugins</h1><p>Work with ChatGPT, Codex, and Whim across your favorite tools.</p></div><div className="header-actions"><button className="secondary-action" type="button" onClick={() => void refresh()} disabled={!native}><RefreshCw size={13} /> Refresh</button><button className="secondary-action" type="button" onClick={() => void openPluginControl()} disabled={!native}><Settings2 size={13} /> Manage</button><button className="primary-action" type="button" onClick={() => void openPluginControl()} disabled={!native}><Plus size={13} /> Create plugin</button></div></header>
    <section className="integration-board full-width">
      <div className="integration-toolbar"><label><Search size={14} /><input aria-label="Search plugins" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plugins" /></label><span className="status-pill active">{catalog.installed.length} installed</span></div>
      {error && <div className="inline-notice"><span>{error}</span></div>}
      <div className="section-heading-row"><div><span className="section-kicker">Connected to this profile</span><h2>Installed</h2></div></div>
      {installed.length === 0 ? <div className="integration-empty compact"><Blocks size={24} /><strong>No installed plugins match</strong></div> : <div className="plugin-grid installed-grid">{installed.map((plugin) => <PluginCard key={plugin.pluginId} plugin={plugin} busy={busyId === plugin.pluginId} onRemove={plugin.pluginId.includes("@") ? () => void changeInstall(plugin, false) : undefined} />)}</div>}
      <div className="section-heading-row plugin-directory-heading"><div><span className="section-kicker">Public directory</span><h2>Featured</h2></div><span>{catalog.available.length} available</span></div>
      {available.length === 0 ? <div className="integration-empty"><Search size={24} /><strong>No available plugins match</strong><span>Try another name or refresh the marketplace snapshot.</span></div> : <div className="plugin-grid">{available.map((plugin) => <PluginCard key={plugin.pluginId} plugin={plugin} busy={busyId === plugin.pluginId} onInstall={() => void changeInstall(plugin, true)} />)}</div>}
    </section>
  </main>;
}

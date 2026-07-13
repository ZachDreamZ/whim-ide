import { useEffect, useMemo, useState } from "react";
import {
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Cpu,
  FileJson,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { automationSettings } from "../data/product";
import { bridge, type EnvironmentReport } from "../lib/bridge";

type AutomationFile = { version: 1; enabled: Record<string, boolean>; updatedAt: string };
type HistoryItem = { id: string; label: string; at: Date };

export function AutopilotHub({ workspace, environment, onOpenFile }: { workspace: string; environment: EnvironmentReport; onOpenFile?: (path: string) => void }) {
  const native = bridge.isNative();
  const defaults = useMemo(() => Object.fromEntries(automationSettings.map((item) => [item.id, item.defaultEnabled])), []);
  const [settings, setSettings] = useState<Record<string, boolean>>(defaults);
  const [report, setReport] = useState(environment);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showAllTools, setShowAllTools] = useState(false);
  const groups = ["Create", "Verify", "Personalize", "Ship"] as const;

  useEffect(() => setReport(environment), [environment]);
  useEffect(() => {
    if (!native) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    bridge.readFile(workspace, ".whim/automation.json").then((raw) => {
      const parsed = JSON.parse(raw) as Partial<AutomationFile>;
      const enabledMap = parsed.enabled;
      if (!enabledMap || typeof enabledMap !== "object" || Array.isArray(enabledMap)) throw new Error(".whim/automation.json has an invalid enabled map.");
      const merged = { ...defaults, ...enabledMap };
      const lockedItems = automationSettings.filter((s) => s.locked);
      const needsNotice = lockedItems.some((s) => enabledMap[s.id] === false);
      lockedItems.forEach((s) => { merged[s.id] = s.defaultEnabled; });
      if (active) {
        setSettings(merged);
        if (needsNotice) setNotice("Normalized policy file: locked safety rules are always enforced.");
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not exist|cannot inspect|not found/i.test(message) && active) setNotice(message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [defaults, workspace, native]);

  const persist = async (next: Record<string, boolean>, action: string, id: string) => {
    if (!native) return;
    setSaving(id);
    setNotice(null);
    try {
      const safe = { ...next };
      automationSettings.filter((s) => s.locked).forEach((s) => { safe[s.id] = s.defaultEnabled; });
      const file: AutomationFile = { version: 1, enabled: safe, updatedAt: new Date().toISOString() };
      await bridge.writeFile(workspace, ".whim/automation.json", `${JSON.stringify(file, null, 2)}\n`, true);
      setSettings(safe);
      setHistory((current) => [{ id: crypto.randomUUID(), label: action, at: new Date() }, ...current].slice(0, 12));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save automation policy."); }
    finally { setSaving(null); }
  };

  const toggle = (id: string, locked?: boolean) => {
    if (!native || locked || saving) return;
    const next = { ...settings, [id]: !settings[id] };
    const item = automationSettings.find((setting) => setting.id === id);
    void persist(next, `${next[id] ? "Enabled" : "Disabled"} ${item?.label ?? id}`, id);
  };

  const pauseAll = () => {
    if (!native) return;
    const next = { ...settings };
    automationSettings.forEach((item) => { if (!item.locked) next[item.id] = false; });
    void persist(next, "Paused all optional automation", "pause-all");
  };

  const resetDefaults = () => {
    if (!native) return;
    void persist(defaults, "Restored default automation policy", "reset");
  };

  const refreshEnvironment = async () => {
    if (!native) return;
    setSaving("environment");
    try { setReport(await bridge.environment()); setHistory((current) => [{ id: crypto.randomUUID(), label: "Rescanned Windows tools", at: new Date() }, ...current]); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Environment scan failed."); }
    finally { setSaving(null); }
  };

  const enabledCount = automationSettings.filter((item) => settings[item.id]).length;
  const enforcedCount = automationSettings.filter((item) => item.locked && settings[item.id]).length;
  const optionalEnabled = enabledCount - enforcedCount;
  const enabledByGroup = groups.map((group) => ({
    group,
    items: automationSettings.filter((item) => item.group === group && settings[item.id]),
    total: automationSettings.filter((item) => item.group === group).length,
  }));
  const tools = showAllTools ? report.tools : report.tools.filter((tool) => tool.installed).slice(0, 8);

  return (
    <main className="hub-page autopilot-page">
      {!native && (
        <div className="inline-notice" style={{ margin: "1.5rem 1.5rem 0 1.5rem" }}>
          <ShieldCheck size={14} />
          <span>Automation policies and PC environment discovery are available in the installed Whim Windows app.</span>
        </div>
      )}
      <section className="market-toolbar" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "#8a95a5", fontSize: "13px" }}>
          <Sparkles size={14} />
          <span><strong>{loading ? "Reading project policy" : `${enabledCount} rules enabled`}</strong> · .whim/automation.json</span>
        </div>
        <button className="secondary-action" type="button" onClick={pauseAll} disabled={Boolean(saving) || optionalEnabled === 0 || !native}>
          {saving === "pause-all" ? "Saving…" : "Pause optional"}
        </button>
      </section>
      <div style={{ margin: "0 32px 32px 32px", maxWidth: "480px" }}>
        <div className="learned-card">
          <div className="learned-head">
            <span><BrainCircuit size={17} /> Current policy</span>
            <em>{enabledCount} of {automationSettings.length} rules</em>
          </div>
          {enabledByGroup.map(({ group, items, total }) => (
            <div key={group} className="learned-group">
              <a href={`#group-${group}`} className="learned-group-head" onClick={(e) => { e.preventDefault(); document.getElementById(`group-${group}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                <span>{group}</span>
                <small>{items.length} of {total}</small>
              </a>
              {items.map((item) => (
                <div className="learned-rule" key={item.id}>
                  <span>{item.label}</span>
                  <strong>{item.description}</strong>
                  {item.locked ? <LockKeyhole size={13} /> : <Check size={13} />}
                </div>
              ))}
              {items.length === 0 && (
                <div className="learned-rule empty">
                  <span>—</span>
                  <strong>No rules enabled in this stage</strong>
                </div>
              )}
            </div>
          ))}
          <button type="button" className="learned-enforce" onClick={() => {
            const safe = { ...settings };
            automationSettings.filter((s) => s.locked).forEach((s) => { safe[s.id] = s.defaultEnabled; });
            void persist(safe, "Enforced safety rules", "enforce-safety");
          }} disabled={Boolean(saving) || !native}>
            <ShieldCheck size={13} />
            <div>
              <strong>Enforce validation</strong>
              <small>Applies to safety rules: Security · Production confirmation</small>
            </div>
            {saving === "enforce-safety" ? <LoaderCircle className="spin" size={11} /> : <span className="chip">{enforcedCount} enforced</span>}
          </button>
          <button type="button" onClick={() => onOpenFile?.(".whim/automation.json")} disabled={!onOpenFile || !native}>
            Open policy file <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {notice && <div className="inline-notice"><ShieldCheck size={14} /><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>Dismiss</button></div>}

      <div className="autopilot-layout">
        <section className="automation-groups">
          {groups.map((group) => <div className="automation-group" key={group} id={`group-${group}`}><div className="automation-group-title"><span>{group}</span><small>{automationSettings.filter((item) => item.group === group && settings[item.id]).length} enabled</small></div>{automationSettings.filter((item) => item.group === group).map((item) => <button className={`automation-row${item.locked ? ' locked-row' : ''}`} type="button" key={item.id} onClick={() => toggle(item.id, item.locked)} disabled={loading || Boolean(saving) || item.locked || !native} aria-disabled={item.locked || undefined} role="switch" aria-checked={settings[item.id]} aria-label={`${item.label}${item.locked ? ' — locked safety rule' : ''}: ${settings[item.id] ? 'On' : 'Off'}`}><span className={`toggle ${settings[item.id] ? "on" : ""} ${item.locked ? "locked" : ""}`} aria-hidden="true"><i aria-hidden="true" /><span className="toggle-text">{settings[item.id] ? "ON" : "OFF"}</span>{item.locked && <LockKeyhole size={9} />}</span><span><strong>{item.label}</strong><small>{item.description}</small>{item.locked && <span className="enforced-chip">🔒 Enforced</span>}</span>{saving === item.id && <LoaderCircle className="spin" size={13} />}</button>)}</div>)}
        </section>

        <aside className="autopilot-sidebar">
          <section className="discovery-card"><div className="aside-card-head"><span><Cpu size={15} /> This PC</span><button type="button" onClick={refreshEnvironment} disabled={saving === "environment" || !native}>{saving === "environment" ? <LoaderCircle className="spin" size={12} /> : <RefreshCw size={12} />}</button></div><p>Native discovery reports the commands Windows can actually launch.</p><div className="tool-list">{tools.map((tool) => <div key={tool.id}><span className={tool.installed ? "tool-ok" : "history-dot coral"}>{tool.installed ? <Check size={10} /> : <CircleDot size={9} />}</span><span><strong>{tool.name}</strong><small>{tool.installed ? tool.version || "available" : "not found"}</small></span></div>)}</div><button className="aside-link" type="button" onClick={() => setShowAllTools((value) => !value)}>{showAllTools ? "Show installed tools" : "Show full environment report"} <ChevronRight size={12} /></button></section>
          <section className="budget-card"><div className="aside-card-head"><span><FileJson size={15} /> Policy storage</span><em>real file</em></div><div className="budget-number"><strong>{enabledCount}</strong><span>of {automationSettings.length} rules</span></div><div className="budget-track" role="progressbar" aria-label="Automation rules enabled" aria-valuenow={enabledCount} aria-valuemin={0} aria-valuemax={automationSettings.length} aria-valuetext={`${enabledCount} of ${automationSettings.length} rules enabled`}><span style={{ width: `${Math.round((enabledCount / automationSettings.length) * 100)}%` }} /></div><div className="budget-stats"><span><small>Optional rules</small><strong>{optionalEnabled} enabled</strong></span><span><small>Safety rules</small><strong>{enforcedCount} enforced</strong></span></div><button className="aside-link" type="button" onClick={resetDefaults} disabled={Boolean(saving) || !native}><RotateCcw size={12} /> Restore defaults</button></section>
          <section className="history-card"><div className="aside-card-head"><span><Clock3 size={15} /> This session</span>{history.length > 0 && <button type="button" onClick={() => setHistory([])} disabled={!native}>Clear</button>}</div>{history.length === 0 ? <div className="history-item"><span className="history-dot violet" /><div><strong>No automation changes yet</strong><small>Real actions will appear here.</small></div></div> : history.map((item) => <div className="history-item" key={item.id}><span className="history-dot mint" /><div><strong>{item.label}</strong><small>{item.at.toLocaleTimeString()}</small></div></div>)}</section>
        </aside>
      </div>

      <section className="safety-tiers"><div><span className="tier-icon auto"><Sparkles size={14} /></span><span><strong>Workspace automatic</strong><small>scoped Whim agent tools and configured checks</small></span></div><div><span className="tier-icon once"><CircleDot size={14} /></span><span><strong>Config-visible</strong><small>providers, MCP servers, plugins, and policy files</small></span></div><div><span className="tier-icon always"><ShieldCheck size={14} /></span><span><strong>Always confirm</strong><small>production and public deployment actions</small></span></div></section>
    </main>
  );
}

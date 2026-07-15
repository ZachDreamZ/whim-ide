import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  Cpu,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { bridge, type DiscoveredProvider } from "../lib/bridge";

const OMNIROUTE_ROUTES = ["auto", "auto/coding", "auto/fast", "auto/cheap", "auto/offline", "auto/smart"];

export function displayModelChoice(value: string) {
  return value === "auto" ? "Vibe (agent chooses)" : value;
}

type ProviderHubProps = {
  workspace: string | null;
  credentials: unknown;
  localProviders: unknown;
  onRefresh: () => void | Promise<void>;
  agentProvider: string;
  agentApiKey: string;
  agentBaseUrl: string;
  agentModel: string;
  onAgentProfileChange: (patch: { provider?: string; apiKey?: string; baseUrl?: string; model?: string }) => void;
};

function ModelDropdown({ value, options, placeholder, onChange }: { value: string; options: string[]; placeholder: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = 240;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight && rect.top > menuHeight ? rect.top - menuHeight : rect.bottom + 4;
    setCoords({ top, left: rect.left, width: rect.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onScroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button type="button" ref={triggerRef} className="model-select-trigger" onClick={() => (open ? setOpen(false) : openMenu())}>
        <span className={value ? "model-select-value" : "model-select-placeholder"}>{value ? displayModelChoice(value) : placeholder}</span>
        <ChevronRight size={11} className="model-select-caret" />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="model-menu" role="listbox" style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}>
          {options.map((id) => (
            <button type="button" key={id} role="option" aria-selected={id === value} className={`model-option${id === value ? " selected" : ""}`} onClick={() => { onChange(id); setOpen(false); }}>{displayModelChoice(id)}</button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

export function ProviderHub({ agentProvider, agentApiKey, agentBaseUrl, agentModel, onAgentProfileChange }: ProviderHubProps) {
  const [discovered, setDiscovered] = useState<DiscoveredProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelLoading, setModelLoading] = useState(false);

  const rescan = async () => {
    setLoading(true);
    try {
      const list = await bridge.discoverProviders();
      setDiscovered(list);
      if (agentProvider !== "auto") {
        const active = list.find((item) => item.provider === agentProvider);
        if (active?.hasKey || active?.available) loadModels(active.provider, agentApiKey, active.baseUrl ?? agentBaseUrl);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Provider scan failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void rescan(); }, []);

  const loadModels = (agentValue: string, apiKey: string, baseUrl: string) => {
    if (!apiKey?.trim() && agentValue !== "local" && agentValue !== "omniroute") return;
    setModelLoading(true);
    bridge.listProviderModels(agentValue, apiKey, baseUrl)
      .then((ids) => {
        if (!Array.isArray(ids)) return;
        const routes = agentValue === "omniroute" ? OMNIROUTE_ROUTES : [];
        setModelOptions([...new Set([...routes, ...ids])]);
      })
      .catch(() => { if (agentValue === "omniroute") setModelOptions(OMNIROUTE_ROUTES); })
      .finally(() => setModelLoading(false));
  };

  const onKeyChange = (value: string) => {
    onAgentProfileChange({ provider: agentProvider, apiKey: value });
    if (value?.trim()) loadModels(agentProvider, value, agentBaseUrl);
  };

  const useProvider = (provider: DiscoveredProvider) => {
    if (provider.kind === "local") {
      onAgentProfileChange({ provider: "local", baseUrl: provider.baseUrl ?? "", apiKey: "" });
    } else {
      const patch: { provider?: string; apiKey?: string; baseUrl?: string; model?: string } = {
        provider: provider.provider,
        baseUrl: provider.baseUrl ?? "",
      };
      // Clear any previously typed key when switching to a different cloud
      // provider so a key for one vendor is never sent to another.
      if (agentProvider !== "auto" && agentProvider !== provider.provider && !provider.hasKey) {
        patch.apiKey = "";
      }
      if (provider.provider === "omniroute") patch.model = "";
      onAgentProfileChange(patch);
    }
    setModelOptions([]);
    if (provider.hasKey || provider.available) loadModels(provider.provider, provider.provider === agentProvider ? agentApiKey : "", provider.baseUrl ?? agentBaseUrl);
  };

  const connectedCount = discovered.filter((item) => item.hasKey || (item.kind !== "cloud" && item.available)).length;

  return (
    <main className="hub-page provider-page">


      <section className="provider-status-strip">
        <span className="status-good"><Check size={13} /> Whim native agent ready</span>
        <span><ShieldCheck size={13} /> {connectedCount} with credentials</span>
        <span>Keys stay on this PC, never exposed in source files</span>
        <button type="button" onClick={rescan} disabled={loading}>Refresh <RefreshCw className={loading ? "spin" : ""} size={12} /></button>
      </section>

      {notice && <div className="inline-notice"><Sparkles size={14} /><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>Dismiss</button></div>}

      <section className="provider-catalog">
        {/* Hero heading removed for minimalistic design */}
        <div className="provider-grid">
          {discovered.map((provider) => {
            const status = provider.available ? (provider.hasKey ? "connected" : "detected") : "available";
            const isActive = agentProvider === provider.provider;
            return (
              <article
                className={`provider-card provider-${status}${isActive ? " active" : ""}`}
                key={provider.provider}
              >
                <div className="provider-card-top">
                  <span className={`provider-logo provider-logo-${provider.kind}`}>{provider.kind === "local" || provider.kind === "gateway" ? <Cpu size={18} /> : <span>{provider.label[0]}</span>}</span>
                  <div><span className={`provider-status ${status}`}>{status === "connected" && <Check size={10} />}{status}</span></div>
                </div>
                <h3>{provider.label}</h3>
                <p>{provider.note ?? ""}</p>
                <small>{provider.capabilities.speechToText && provider.capabilities.textToSpeech ? "Chat · transcription · speech" : "Chat"}</small>
                {isActive && (
                  <div className="provider-card-model">
                    <span className="active-dot" aria-hidden="true" />
                    <label className="provider-card-model-label" htmlFor={`model-${provider.provider}`}>Model</label>
                    {modelLoading ? (
                      <span className="model-loading"><LoaderCircle className="spin" size={12} /> Loading…</span>
                    ) : modelOptions.length ? (
                      <ModelDropdown
                        value={agentModel}
                        options={[...new Set(["auto", ...modelOptions])]}
                        placeholder="Vibe (agent chooses)"
                        onChange={(id) => onAgentProfileChange({ provider: agentProvider, model: id === "auto" ? "" : id })}
                      />
                    ) : (
                      <input id={`model-${provider.provider}`} value={agentModel} placeholder="Vibe (agent chooses)" onChange={(event) => onAgentProfileChange({ provider: agentProvider, model: event.target.value })} />
                    )}
                    <button type="button" className="reset-auto" title="Use Vibe routing" onClick={() => onAgentProfileChange({ provider: "auto" })}>Vibe</button>
                  </div>
                )}
                {isActive && provider.kind !== "local" && (
                  <div className="provider-card-config">
                    <label htmlFor={`key-${provider.provider}`}>API key
                      <span className="provider-card-hint">In-session only — never saved to disk</span>
                    </label>
                    <input id={`key-${provider.provider}`} type="password" value={agentApiKey} placeholder="Paste your API key" autoComplete="off" spellCheck={false} onChange={(event) => onKeyChange(event.target.value)} />
                    {(provider.provider === "compatible" || provider.provider === "qwen" || provider.provider === "omniroute") && (
                      <label htmlFor={`base-${provider.provider}`}>Base URL</label>
                    )}
                    {(provider.provider === "compatible" || provider.provider === "qwen" || provider.provider === "omniroute") && (
                      <input id={`base-${provider.provider}`} value={agentBaseUrl} placeholder={provider.provider === "qwen" ? "https://dashscope.aliyuncs.com/compatible-mode/v1" : provider.provider === "omniroute" ? "http://127.0.0.1:20128/v1" : "https://api.your-host/v1"} autoComplete="off" spellCheck={false} onChange={(event) => onAgentProfileChange({ provider: agentProvider, baseUrl: event.target.value })} />
                    )}
                  </div>
                )}
                <div className="provider-card-footer">
                  <span>{provider.kind}</span>
                  {isActive
                    ? <span className="active-pill"><span className="active-dot" /> Active</span>
                    : <button type="button" onClick={() => useProvider(provider)}>Use</button>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="provider-footer">
        <article className="policy-card policy-card-wide"><span className="policy-icon violet"><ShieldCheck size={17} /></span><div><small>Credential policy</small><h3>Authentication stays on this PC.</h3><p>Cloud keys are read from your environment or typed in-session. They are never persisted in workspace source files.</p></div></article>
      </section>
    </main>
  );
}

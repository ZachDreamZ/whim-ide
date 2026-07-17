import { useCallback, useEffect, useRef, useState } from "react";
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
import { bridge, type DiscoveredProvider, type OAuthProviderStatus } from "../lib/bridge";

const OMNIROUTE_ROUTES = ["auto", "auto/coding", "auto/fast", "auto/cheap", "auto/offline", "auto/smart"];
const MODEL_DISCOVERY_DELAY_MS = 350;

export function displayModelChoice(value: string) {
  return value === "auto" ? "Vibe (agent chooses)" : value;
}

export function isProviderReady(provider: DiscoveredProvider) {
  return provider.kind === "cloud" ? provider.hasKey : provider.available;
}

type ProviderHubProps = {
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
      <button
        type="button"
        ref={triggerRef}
        className="model-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
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

export function ProviderHub({ onRefresh, agentProvider, agentApiKey, agentBaseUrl, agentModel, onAgentProfileChange }: ProviderHubProps) {
  const [discovered, setDiscovered] = useState<DiscoveredProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const scanRequest = useRef(0);
  const modelRequest = useRef(0);

  const rescan = useCallback(async () => {
    const request = ++scanRequest.current;
    setLoading(true);
    try {
      const list = await bridge.discoverProviders();
      if (request !== scanRequest.current) return;
      setDiscovered(list);
      setNotice(null);
    } catch {
      if (request === scanRequest.current) {
        setNotice("Provider scan failed. Try refreshing the catalog.");
      }
    } finally {
      if (request === scanRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void rescan();
    return () => { scanRequest.current += 1; };
  }, [rescan]);

  useEffect(() => {
    const request = ++modelRequest.current;
    const active = discovered.find((provider) => provider.provider === agentProvider);
    const canLoad = Boolean(active) && (
      agentProvider === "omniroute"
      || (active?.kind === "local" && active.available)
      || (active?.kind === "cloud" && (active.hasKey || agentApiKey.trim().length > 0))
    );

    setModelOptions([]);
    if (!active || !canLoad || agentProvider === "auto") {
      setModelLoading(false);
      return;
    }

    setModelLoading(true);
    const timer = window.setTimeout(() => {
      bridge.listProviderModels(agentProvider, agentApiKey, agentBaseUrl || active.baseUrl || "")
        .then((ids) => {
          if (request !== modelRequest.current || !Array.isArray(ids)) return;
          const routes = agentProvider === "omniroute" ? OMNIROUTE_ROUTES : [];
          setModelOptions([...new Set([...routes, ...ids])]);
        })
        .catch(() => {
          if (request !== modelRequest.current) return;
          if (agentProvider === "omniroute") {
            setModelOptions(OMNIROUTE_ROUTES);
          } else {
            setNotice(`Could not load ${active.label} models. You can enter a model ID manually.`);
          }
        })
        .finally(() => {
          if (request === modelRequest.current) setModelLoading(false);
        });
    }, MODEL_DISCOVERY_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      if (request === modelRequest.current) modelRequest.current += 1;
    };
  }, [agentApiKey, agentBaseUrl, agentProvider, discovered]);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([Promise.resolve().then(onRefresh), rescan()]);
  }, [onRefresh, rescan]);

  const onKeyChange = (value: string) => {
    onAgentProfileChange({ provider: agentProvider, apiKey: value });
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
  };

  const [oauthStatus, setOauthStatus] = useState<OAuthProviderStatus[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [oauthNotice, setOauthNotice] = useState<string | null>(null);

  // Load OAuth provider status
  useEffect(() => {
    if (!bridge.isNative()) return;
    bridge.oauthListProviders()
      .then(setOauthStatus)
      .catch(() => { /* keyring may not be available */ });
  }, []);

  const oauthConnect = async (providerId: string) => {
    setConnecting(providerId);
    setOauthNotice(null);
    try {
      await bridge.oauthAuthorize({ providerId });
      setOauthNotice(`✓ ${providerId.charAt(0).toUpperCase() + providerId.slice(1)} connected successfully!`);
      // Refresh status
      const status = await bridge.oauthListProviders();
      setOauthStatus(status);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setOauthNotice(`Failed to connect ${providerId}: ${msg}`);
    } finally {
      setConnecting(null);
    }
  };

  const oauthDisconnect = async (providerId: string) => {
    setConnecting(providerId);
    try {
      await bridge.oauthClearToken(providerId);
      const status = await bridge.oauthListProviders();
      setOauthStatus(status);
      setOauthNotice(`Disconnected ${providerId}.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setOauthNotice(`Failed to disconnect: ${msg}`);
    } finally {
      setConnecting(null);
    }
  };

  const connectedCount = discovered.filter(isProviderReady).length;

  return (
    <main className="hub-page provider-page">


      <section className="provider-status-strip">
        <span className="status-good"><Check size={13} /> Whim native runtime ready</span>
        <span><ShieldCheck size={13} /> {connectedCount} {connectedCount === 1 ? "provider" : "providers"} ready</span>
        <span>Keys stay on this PC, never exposed in source files or renderer state</span>
        <button type="button" onClick={() => void refreshAll()} disabled={loading}>Refresh <RefreshCw className={loading ? "spin" : ""} size={12} /></button>
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

      {oauthStatus.length > 0 && (
        <section className="oauth-section">
          <h3 className="oauth-heading">
            <ShieldCheck size={15} />
            Connected Accounts (OAuth)
          </h3>
          {oauthNotice && (
            <div className="inline-notice">
              <Sparkles size={14} />
              <span>{oauthNotice}</span>
              <button type="button" onClick={() => setOauthNotice(null)}>Dismiss</button>
            </div>
          )}
          <div className="oauth-provider-grid">
            {oauthStatus.map((provider) => (
              <div key={provider.id} className={`oauth-provider-card${provider.hasToken ? " connected" : ""}`}>
                <div className="oauth-provider-info">
                  <span className="oauth-provider-name">{provider.name}</span>
                  {provider.hasToken ? (
                    <span className="oauth-token-status">
                      <Check size={12} />
                      Connected
                      {provider.tokenPreview && <code className="oauth-token-preview">{provider.tokenPreview}</code>}
                    </span>
                  ) : (
                    <span className="oauth-token-status disconnected">Not connected</span>
                  )}
                </div>
                <div className="oauth-provider-actions">
                  {provider.hasToken ? (
                    <button
                      type="button"
                      className="oauth-disconnect-btn"
                      disabled={connecting === provider.id}
                      onClick={() => void oauthDisconnect(provider.id)}
                    >
                      {connecting === provider.id ? "Disconnecting…" : "Disconnect"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="oauth-connect-btn"
                      disabled={connecting !== null}
                      onClick={() => void oauthConnect(provider.id)}
                    >
                      {connecting === provider.id ? (
                        <><LoaderCircle className="spin" size={12} /> Connecting…</>
                      ) : (
                        "Connect"
                      )}
                    </button>
                  )}
                </div>
                <p className="oauth-provider-hint">
                  {provider.id === "github" && "Sign in with GitHub for Copilot and API access."}
                  {provider.id === "google" && "Sign in with Google for Gemini and Cloud AI."}
                  {provider.id === "azure" && "Sign in with Microsoft for Azure OpenAI."}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="provider-footer">
        <article className="policy-card policy-card-wide"><span className="policy-icon violet"><ShieldCheck size={17} /></span><div><small>Credential policy</small><h3>Authentication stays on this PC.</h3><p>Cloud keys can come from your environment, supported local auth stores, or an in-session entry. Stored keys remain in the Rust process and are never copied into workspace files or renderer state.</p></div></article>
      </section>
    </main>
  );
}

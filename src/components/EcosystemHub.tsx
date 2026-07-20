import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CircleDot,
  Clock3,
  LoaderCircle,
  PackageCheck,
  PackagePlus,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { bridge } from "../lib/bridge";

type EcosystemHubProps = { workspace: string };
type IntegrationKind = "MCP" | "Plugin";
type CustomKind = "mcp" | "plugin";

type Integration = {
  key: string;
  id: string;
  name: string;
  author: string;
  description: string;
  kind: IntegrationKind;
  permissions: string[];
  icon: LucideIcon;
  color: string;
  mcpEntry?: Record<string, unknown>;
  packageName?: string;
  custom?: boolean;
};

const officialIntegrations: Integration[] = [
  {
    key: "mcp:context7",
    id: "context7",
    name: "Context7",
    author: "Context7",
    description: "Remote documentation MCP configured at mcp.context7.com.",
    kind: "MCP",
    permissions: ["Remote network"],
    icon: BookOpen,
    color: "#8faeff",
    mcpEntry: { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true },
  },
  {
    key: "mcp:grep",
    id: "grep",
    name: "Grep by Vercel",
    author: "Vercel",
    description: "Remote code-search MCP configured at mcp.grep.app.",
    kind: "MCP",
    permissions: ["Remote network"],
    icon: Search,
    color: "#f0f1f4",
    mcpEntry: { type: "remote", url: "https://mcp.grep.app", enabled: true },
  },
  {
    key: "mcp:sentry",
    id: "sentry",
    name: "Sentry",
    author: "Sentry",
    description: "Remote Sentry MCP with OAuth enabled.",
    kind: "MCP",
    permissions: ["Remote network", "OAuth"],
    icon: ShieldCheck,
    color: "#c6a4ff",
    mcpEntry: { type: "remote", url: "https://mcp.sentry.dev/mcp", oauth: {}, enabled: true },
  },
  {
    key: "plugin:helicone-session",
    id: "helicone-session",
    name: "Helicone Session",
    author: "npm",
    description: "npm plugin for session tracing.",
    kind: "Plugin",
    permissions: ["Whim runtime"],
    icon: PackageCheck,
    color: "#73d9ae",
    packageName: "helicone-session",
  },
  {
    key: "plugin:wakatime",
    id: "wakatime",
    name: "WakaTime",
    author: "npm",
    description: "npm plugin for time tracking.",
    kind: "Plugin",
    permissions: ["Whim runtime"],
    icon: Clock3,
    color: "#f6c66f",
    packageName: "wakatime",
  },
];

const officialMcpIds = new Set(
  officialIntegrations.filter((item) => item.kind === "MCP").map((item) => item.id),
);
const officialPackages = new Set(
  officialIntegrations.flatMap((item) => item.packageName ? [item.packageName] : []),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateConfig(config: Record<string, unknown>) {
  const ecosystem = isRecord(config.ecosystem) ? config.ecosystem : {};
  if (ecosystem.mcp !== undefined && !isRecord(ecosystem.mcp)) {
    throw new Error('The "ecosystem.mcp" field in .whim/config.json must be an object before Whim can edit integrations.');
  }
  if (ecosystem.plugin !== undefined && (!Array.isArray(ecosystem.plugin) || ecosystem.plugin.some((item) => typeof item !== "string"))) {
    throw new Error('The "ecosystem.plugin" field in .whim/config.json must be an array of npm package names before Whim can edit integrations.');
  }
}

function ecosystemScope(config: Record<string, unknown> | null): Record<string, unknown> {
  return config && isRecord(config.ecosystem) ? config.ecosystem : {};
}

function mcpEntries(config: Record<string, unknown> | null): Record<string, unknown> {
  const scope = ecosystemScope(config);
  return isRecord(scope.mcp) ? scope.mcp : {};
}

function pluginEntries(config: Record<string, unknown> | null): string[] {
  const scope = ecosystemScope(config);
  return Array.isArray(scope.plugin)
    ? scope.plugin.filter((item): item is string => typeof item === "string")
    : [];
}

function isInstalled(integration: Integration, config: Record<string, unknown> | null) {
  if (integration.kind === "MCP") {
    return Object.prototype.hasOwnProperty.call(mcpEntries(config), integration.id);
  }
  return Boolean(integration.packageName && pluginEntries(config).includes(integration.packageName));
}

function customIntegrations(config: Record<string, unknown> | null): Integration[] {
  if (!config) return [];
  const customMcp = Object.entries(mcpEntries(config))
    .filter(([id]) => !officialMcpIds.has(id))
    .map(([id, value]) => {
      const entry = isRecord(value) ? value : {};
      const url = typeof entry.url === "string" ? entry.url : "Custom MCP entry in .whim/config.json";
      return {
        key: `mcp:${id}`,
        id,
        name: id,
        author: ".whim/config.json",
        description: url,
        kind: "MCP" as const,
        permissions: ["Remote network"],
        icon: Plug,
        color: "#67d7ee",
        mcpEntry: entry,
        custom: true,
      };
    });
  const customPlugins = pluginEntries(config)
    .filter((packageName) => !officialPackages.has(packageName))
    .map((packageName) => ({
      key: `plugin:${packageName}`,
      id: packageName,
      name: packageName,
      author: ".whim/config.json",
      description: `npm plugin: ${packageName}`,
      kind: "Plugin" as const,
      permissions: ["Whim runtime"],
      icon: PackagePlus,
      color: "#ff9a7f",
      packageName,
      custom: true,
    }));
  return [...customMcp, ...customPlugins];
}

function configWithIntegration(
  config: Record<string, unknown>,
  integration: Integration,
  install: boolean,
): Record<string, unknown> {
  validateConfig(config);
  const next = { ...config };
  const scope = { ...ecosystemScope(config) };
  if (integration.kind === "MCP") {
    const mcp = { ...mcpEntries(config) };
    if (install) {
      if (!integration.mcpEntry) throw new Error(`No MCP configuration is defined for ${integration.name}.`);
      mcp[integration.id] = integration.mcpEntry;
    } else {
      delete mcp[integration.id];
    }
    scope.mcp = mcp;
    next.ecosystem = scope;
    return next;
  }

  if (!integration.packageName) throw new Error(`No npm package is defined for ${integration.name}.`);
  const plugins = pluginEntries(config);
  scope.plugin = install
    ? [...new Set([...plugins, integration.packageName])]
    : plugins.filter((packageName) => packageName !== integration.packageName);
  next.ecosystem = scope;
  return next;
}

function validMcpId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

function validPackageName(value: string) {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value);
}

function validRemoteUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function EcosystemHub({ workspace }: EcosystemHubProps) {
  const native = bridge.isNative();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"All" | IntegrationKind>("All");
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customKind, setCustomKind] = useState<CustomKind>("mcp");
  const [customId, setCustomId] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const loadVersion = useRef(0);

  const loadConfig = useCallback(async () => {
    if (!native) {
      setLoading(false);
      return;
    }
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const next = await bridge.readWhimConfig(workspace);
      validateConfig(next);
      if (version === loadVersion.current) setConfig(next);
    } catch (loadError) {
      if (version !== loadVersion.current) return;
      setConfig(null);
      setError(loadError instanceof Error ? loadError.message : "Could not read .whim/config.json.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [workspace, native]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!customOpen || !native) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busyKey !== "custom") setCustomOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [customOpen, busyKey, native]);

  const integrations = useMemo(
    () => [...officialIntegrations, ...customIntegrations(config)],
    [config],
  );
  const shown = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return integrations.filter((integration) => {
      const matchesKind = kind === "All" || integration.kind === kind;
      const matchesQuery = !normalizedQuery || `${integration.name} ${integration.id} ${integration.description}`.toLowerCase().includes(normalizedQuery);
      return matchesKind && matchesQuery;
    });
  }, [integrations, kind, query]);
  const kinds: Array<"All" | IntegrationKind> = ["All", "MCP", "Plugin"];

  const toggleIntegration = async (integration: Integration) => {
    if (!config || loading || busyKey || !native) return;
    const install = !isInstalled(integration, config);
    setBusyKey(integration.key);
    setError(null);
    setNotice(null);
    try {
      const latest = await bridge.readWhimConfig(workspace);
      const next = configWithIntegration(latest, integration, install);
      await bridge.writeWhimConfig(workspace, next);
      if (integration.kind === "MCP") {
        await bridge.mcpReload(workspace);
      }
      setConfig(next);
      setNotice(`${integration.name} ${install ? "added to" : "removed from"} .whim/config.json.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Could not ${install ? "add" : "remove"} ${integration.name}.`);
    } finally {
      setBusyKey(null);
    }
  };

  const openCustom = () => {
    if (!native) return;
    setCustomKind("mcp");
    setCustomId("");
    setCustomValue("");
    setCustomError(null);
    setCustomOpen(true);
  };

  const submitCustom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyKey || !native) return;
    const id = customId.trim();
    const value = customValue.trim();
    if (customKind === "mcp") {
      if (!validMcpId(id)) {
        setCustomError("MCP id must use 1–64 letters, numbers, hyphens, or underscores, and start with a letter or number.");
        return;
      }
      if (!validRemoteUrl(value)) {
        setCustomError("Enter a complete http:// or https:// MCP URL.");
        return;
      }
    } else if (!validPackageName(value)) {
      setCustomError("Enter a valid lowercase npm package name, optionally with an @scope/ prefix.");
      return;
    }

    setBusyKey("custom");
    setCustomError(null);
    setError(null);
    try {
      const latest = await bridge.readWhimConfig(workspace);
      validateConfig(latest);
      const integration: Integration = customKind === "mcp"
        ? {
            key: `mcp:${id}`,
            id,
            name: id,
            author: "Custom",
            description: value,
            kind: "MCP",
            permissions: ["Remote network"],
            icon: Plug,
            color: "#67d7ee",
            mcpEntry: { type: "remote", url: value, enabled: true },
            custom: true,
          }
        : {
            key: `plugin:${value}`,
            id: value,
            name: value,
            author: "Custom",
            description: `npm plugin: ${value}`,
            kind: "Plugin",
            permissions: ["Whim runtime"],
            icon: PackagePlus,
            color: "#ff9a7f",
            packageName: value,
            custom: true,
          };
      if (isInstalled(integration, latest)) {
        setCustomError(`${integration.name} already exists in .whim/config.json.`);
        return;
      }
      const next = configWithIntegration(latest, integration, true);
      await bridge.writeWhimConfig(workspace, next);
      if (customKind === "mcp") {
        await bridge.mcpReload(workspace);
      }
      setConfig(next);
      setNotice(`${integration.name} added to .whim/config.json.`);
      setCustomOpen(false);
    } catch (actionError) {
      setCustomError(actionError instanceof Error ? actionError.message : "Could not add the integration.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <main className="hub-page ecosystem-page">
      {!native && (
        <div className="inline-notice" style={{ margin: "1.5rem 1.5rem 0 1.5rem" }}>
          <Plug size={14} />
          <span>MCP server integration and plugins are available in the installed Whim Windows app.</span>
        </div>
      )}


      <section className="market-toolbar">
        <div className="market-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search configured and available integrations" aria-label="Search integrations" /></div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="secondary-action" type="button" onClick={() => void loadConfig()} disabled={loading || Boolean(busyKey) || !native}>
            <RefreshCw className={loading ? "spin" : ""} size={14} /> Refresh
          </button>
          <button className="primary-action" type="button" onClick={openCustom} disabled={loading || Boolean(busyKey) || !native}>
            <Plus size={14} /> Add custom
          </button>
        </div>
      </section>

      {error && <div className="inline-notice"><ShieldCheck size={14} /><span>{error}</span><button type="button" onClick={() => void loadConfig()} disabled={loading}>Retry</button></div>}
      {notice && <div className="inline-notice"><Check size={14} /><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>Dismiss</button></div>}

      <div className="market-layout">
        <aside className="market-sidebar">
          <span>Browse</span>
          {kinds.map((item) => (
            <button className={kind === item ? "active" : ""} type="button" key={item} onClick={() => setKind(item)}>
              {item}<em>{item === "All" ? integrations.length : integrations.filter((integration) => integration.kind === item).length}</em>
            </button>
          ))}
          <div className="market-divider" />
          <span>Source</span>
          <div style={{ padding: "5px 7px", color: "#687384", fontSize: 8, lineHeight: 1.5 }}>Workspace<br />.whim/config.json</div>
        </aside>

        <section className="plugin-results">
          <div className="section-heading-row">
            <div><span className="section-kicker">{kind === "All" ? "Workspace integrations" : kind}</span><h2>{loading ? "Reading .whim/config.json…" : `${shown.length} integration${shown.length === 1 ? "" : "s"}`}</h2></div>
            <span className="signed-note"><ShieldCheck size={13} /> backed by .whim/config.json</span>
          </div>
          <div className="plugin-grid">
            {shown.map((integration) => {
              const Icon = integration.icon;
              const installed = isInstalled(integration, config);
              const busy = busyKey === integration.key;
              return (
                <article className="plugin-card" key={integration.key}>
                  <div className="plugin-card-head">
                    <span className="plugin-icon" style={{ "--plugin-color": integration.color } as React.CSSProperties}><Icon size={19} /></span>
                    <span className="plugin-kind">{integration.custom ? `Custom ${integration.kind}` : integration.kind}</span>
                  </div>
                  <h3>{integration.name}</h3>
                  <small>by {integration.author}</small>
                  <p>{integration.description}</p>
                  <div className="permission-chips">{integration.permissions.map((permission) => <span key={permission}><CircleDot size={9} />{permission}</span>)}</div>
                  <button
                    className={installed ? "installed" : ""}
                    type="button"
                    onClick={() => void toggleIntegration(integration)}
                    disabled={!config || loading || Boolean(busyKey) || !native}
                  >
                    {busy ? <LoaderCircle className="spin" size={13} /> : installed ? <Check size={13} /> : <Plus size={13} />}
                    {busy ? "Writing config…" : installed ? "Installed — Remove" : "Add to workspace"}
                  </button>
                </article>
              );
            })}
          </div>
          {!loading && shown.length === 0 && (
            <div className="palette-empty"><Search size={18} /><span><strong>No integrations match</strong><small>Change the search or category filter.</small></span></div>
          )}
        </section>
      </div>

      <section className="ecosystem-trust-strip" style={{ gridTemplateColumns: "35px 1fr" }}>
        <span><PackageCheck size={17} /></span>
        <div><strong>Every change is a readable config edit.</strong><p>Whim rereads .whim/config.json before writing, preserves unrelated keys, and reports write or validation failures without claiming installation.</p></div>
      </section>

      {customOpen && (
        <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busyKey !== "custom") setCustomOpen(false); }}>
          <form className="command-palette" role="dialog" aria-modal="true" aria-label="Add custom integration" onSubmit={submitCustom}>
            <div className="palette-search">
              <PackagePlus size={17} />
              <strong style={{ flex: 1, color: "#e3e6eb", fontSize: 12 }}>Add custom integration</strong>
              <button type="button" onClick={() => setCustomOpen(false)} disabled={busyKey === "custom"} aria-label="Close" style={{ width: 28, height: 28, display: "grid", placeItems: "center", border: 0, borderRadius: 6, color: "#8791a0", background: "transparent" }}><X size={15} /></button>
            </div>
            <div style={{ padding: 14, display: "grid", gap: 12 }}>
              <div className="filter-pills" aria-label="Integration type">
                <button className={customKind === "mcp" ? "active" : ""} type="button" onClick={() => { setCustomKind("mcp"); setCustomId(""); setCustomValue(""); setCustomError(null); }}>Remote MCP</button>
                <button className={customKind === "plugin" ? "active" : ""} type="button" onClick={() => { setCustomKind("plugin"); setCustomId(""); setCustomValue(""); setCustomError(null); }}>npm plugin</button>
              </div>
              {customKind === "mcp" && (
                <label style={{ display: "grid", gap: 5, color: "#8c95a3", fontSize: 8 }}>
                  MCP id
                  <div className="market-search" style={{ minHeight: 38 }}><Plug size={14} /><input autoFocus value={customId} onChange={(event) => setCustomId(event.target.value)} placeholder="my-mcp" /></div>
                </label>
              )}
              <label style={{ display: "grid", gap: 5, color: "#8c95a3", fontSize: 8 }}>
                {customKind === "mcp" ? "Remote MCP URL" : "npm package name"}
                <div className="market-search" style={{ minHeight: 38 }}>
                  {customKind === "mcp" ? <Plug size={14} /> : <PackagePlus size={14} />}
                  <input
                    autoFocus={customKind === "plugin"}
                    value={customValue}
                    onChange={(event) => setCustomValue(event.target.value)}
                    placeholder={customKind === "mcp" ? "https://example.com/mcp" : "my-plugin-name"}
                  />
                </div>
              </label>
              {customError && <div className="inline-notice" style={{ margin: 0 }}><ShieldCheck size={14} /><span>{customError}</span></div>}
            </div>
            <div className="palette-footer" style={{ height: 44, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setCustomOpen(false)} disabled={busyKey === "custom"} style={{ height: 27, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 6, color: "#8791a0", background: "transparent", fontSize: 8 }}>Cancel</button>
              <button type="submit" disabled={busyKey === "custom"} style={{ height: 27, padding: "0 11px", display: "flex", alignItems: "center", gap: 5, border: 0, borderRadius: 6, color: "#1d1110", background: "var(--coral)", fontSize: 8 }}>
                {busyKey === "custom" ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />} Add integration
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

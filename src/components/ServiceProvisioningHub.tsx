import { useCallback, useEffect, useState } from "react";
import { Container, Database, LoaderCircle, Play, Plus, RefreshCw, Square, Trash2, type LucideIcon } from "lucide-react";
import { bridge, type ServiceResource } from "../lib/bridge";

const serviceDefs: Array<{ kind: "Postgres" | "Redis"; icon: LucideIcon; color: string }> = [
  { kind: "Postgres", icon: Database, color: "#336791" },
  { kind: "Redis", icon: Container, color: "#dc382d" },
];

function serviceIcon(kind: "Postgres" | "Redis"): LucideIcon {
  return serviceDefs.find((d) => d.kind === kind)?.icon ?? Database;
}

function serviceColor(kind: "Postgres" | "Redis"): string {
  return serviceDefs.find((d) => d.kind === kind)?.color ?? "#888";
}

export function ServiceProvisioningHub() {
  const native = bridge.isNative();
  const [services, setServices] = useState<ServiceResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [showProvision, setShowProvision] = useState(false);
  const [provisionKind, setProvisionKind] = useState<"Postgres" | "Redis">("Postgres");
  const [provisionName, setProvisionName] = useState("");
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!native) return;
    setLoading(true);
    setError(null);
    try {
      setServices(await bridge.listServices());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load services.");
    } finally {
      setLoading(false);
    }
  }, [native]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleProvision = async () => {
    setProvisionBusy(true);
    setProvisionError(null);
    try {
      const svc = await bridge.provisionService({ kind: provisionKind, name: provisionName.trim() || undefined });
      setServices((prev) => [...prev, svc]);
      setShowProvision(false);
      setProvisionName("");
    } catch (cause) {
      setProvisionError(cause instanceof Error ? cause.message : "Provisioning failed.");
    } finally {
      setProvisionBusy(false);
    }
  };

  const handleAction = async (id: string, action: () => Promise<ServiceResource | void>) => {
    setActionBusy(id);
    try {
      const updated = await action();
      if (updated && "status" in updated) {
        setServices((prev) => prev.map((s) => s.id === id ? (updated as ServiceResource) : s));
      } else {
        setServices((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed.");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <main className="hub-page integration-page" aria-label="Services">
      <header className="integration-hero">
        <div>
          <span className="section-kicker"><Database size={13} /> Services</span>
          <h1>Service provisioning</h1>
          <p>Provision local development services via Docker Compose.</p>
        </div>
        <div className="integration-actions">
          <button className="primary-action" type="button" onClick={() => setShowProvision(!showProvision)} disabled={!native}>
            <Plus size={13} /> Provision
          </button>
          <button className="secondary-action" type="button" onClick={() => void refresh()} disabled={!native || loading}>
            <RefreshCw className={loading ? "spin" : ""} size={13} /> Refresh
          </button>
        </div>
      </header>

      {error && <div className="inline-notice">{error}</div>}

      {showProvision && (
        <section className="integration-board full-width">
          <div className="provision-form">
            <h3>New service</h3>
            <div className="provision-kind-select">
              {serviceDefs.map((def) => {
                const Icon = def.icon;
                return (
                  <button
                    key={def.kind}
                    type="button"
                    onClick={() => setProvisionKind(def.kind)}
                    className={`provision-kind-btn ${provisionKind === def.kind ? "active" : ""}`}
                  >
                    <Icon size={20} style={{ color: def.color }} />
                    {def.kind}
                  </button>
                );
              })}
            </div>
            <label>
              Name (optional)
              <input value={provisionName} onChange={(e) => setProvisionName(e.target.value)} placeholder={`my-${provisionKind.toLowerCase()}`} disabled={provisionBusy} />
            </label>
            <div className="provision-actions">
              <button className="primary-action" type="button" onClick={handleProvision} disabled={provisionBusy}>
                {provisionBusy ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />}
                Provision {provisionKind}
              </button>
              <button className="secondary-action" type="button" onClick={() => setShowProvision(false)} disabled={provisionBusy}>Cancel</button>
            </div>
            {provisionError && <p className="provision-error">{provisionError}</p>}
          </div>
        </section>
      )}

      <section className="integration-board full-width">
        {services.length === 0 && !loading ? (
          <div className="integration-empty">
            <Database size={28} />
            <strong>No services provisioned</strong>
            <span>Provision PostgreSQL or Redis databases for local development.</span>
          </div>
        ) : (
          <ul className="service-list">
            {services.map((svc) => {
              const Icon = serviceIcon(svc.kind);
              const busy = actionBusy === svc.id;
              const revealed = revealedSecrets.has(svc.id);
              const statusColor = svc.status === "Running" ? "#22c55e" : svc.status === "Stopped" ? "#a0a0a0" : svc.status === "Error" ? "#ef4444" : "#f59e0b";
              return (
                <li key={svc.id} className="service-item">
                  <div className="service-header">
                    <Icon size={20} style={{ color: serviceColor(svc.kind) }} />
                    <div>
                      <strong>{svc.name}</strong>
                      <p>{svc.kind} · port {svc.port}</p>
                    </div>
                    <span className="status-pill" style={{ borderColor: statusColor, color: statusColor }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: statusColor, marginRight: 4 }} />
                      {svc.status}
                    </span>
                  </div>
                  <div className="service-connection">
                    <code className="service-conn-str">
                      {revealed ? svc.connectionString : svc.connectionString.replace(/\/\/:[^@]+@/, "//:****@")}
                    </code>
                    <button className="secondary-action" type="button" onClick={() => setRevealedSecrets((prev) => { const next = new Set(prev); if (revealed) next.delete(svc.id); else next.add(svc.id); return next; })}>
                      {revealed ? "Hide" : "Show"}
                    </button>
                  </div>
                  <div className="service-actions">
                    {svc.status === "Running" ? (
                      <button className="secondary-action" type="button" onClick={() => void handleAction(svc.id, () => bridge.stopService(svc.id))} disabled={busy}>
                        {busy ? <LoaderCircle className="spin" size={13} /> : <Square size={13} />} Stop
                      </button>
                    ) : (
                      <button className="primary-action" type="button" onClick={() => void handleAction(svc.id, () => bridge.startService(svc.id))} disabled={busy}>
                        {busy ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />} Start
                      </button>
                    )}
                    <button className="secondary-action danger" type="button" onClick={() => void handleAction(svc.id, () => bridge.removeService(svc.id))} disabled={busy}>
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

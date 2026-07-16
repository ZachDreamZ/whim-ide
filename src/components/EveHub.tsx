import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  CalendarClock,
  CheckCircle2,
  FileCode2,
  FlaskConical,
  LoaderCircle,
  Orbit,
  PlayCircle,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { bridge, type EveProjectStatus } from "../lib/bridge";

type EveHubProps = {
  workspace: string;
  onOpenFile: (path: string) => void;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Could not inspect this Eve project.");
}

function SlotCard({ icon: Icon, title, files }: { icon: LucideIcon; title: string; files: string[] }) {
  return (
    <article className="eve-slot-card">
      <header><Icon size={15} /><strong>{title}</strong><span>{files.length}</span></header>
      {files.length > 0 ? (
        <ul>{files.slice(0, 6).map((file) => <li key={file} title={file}>{file}</li>)}</ul>
      ) : <p>Nothing authored yet.</p>}
      {files.length > 6 && <small>+{files.length - 6} more</small>}
    </article>
  );
}

export function EveHub({ workspace, onOpenFile }: EveHubProps) {
  const native = bridge.isNative();
  const [status, setStatus] = useState<EveProjectStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!native) return;
    setLoading(true);
    setError(null);
    try {
      setStatus(await bridge.inspectEveWorkspace(workspace));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [native, workspace]);

  useEffect(() => { void refresh(); }, [refresh]);

  const validate = async () => {
    if (!native || validating) return;
    setValidating(true);
    setError(null);
    try {
      setStatus(await bridge.validateEveWorkspace(workspace));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setValidating(false);
    }
  };

  return (
    <main className="hub-page eve-page">
      <section className="eve-hero">
        <div>
          <span className="section-kicker"><Orbit size={13} /> Vercel Eve interoperability</span>
          <h1>Filesystem-first agents, inside Whim</h1>
          <p>Whim reads Eve instructions as project context, exposes Markdown skills as lazy <code>/commands</code>, and starts Eve previews headlessly on loopback.</p>
        </div>
        <div className="eve-actions">
          <button className="secondary-action" type="button" onClick={() => void refresh()} disabled={!native || loading || validating}>
            <RefreshCw className={loading ? "spin" : ""} size={14} /> Refresh
          </button>
          <button className="primary-action" type="button" onClick={() => void validate()} disabled={!native || !status?.detected || !status.cliAvailable || validating} title="Runs the project-local eve info command, which can compile project-authored TypeScript">
            {validating ? <LoaderCircle className="spin" size={14} /> : <PlayCircle size={14} />} Run eve info
          </button>
        </div>
      </section>

      {!native && <div className="inline-notice"><ShieldCheck size={14} /><span>Eve project inspection is available in the installed Whim desktop app.</span></div>}
      {error && <div className="inline-notice"><ShieldCheck size={14} /><span>{error}</span><button type="button" onClick={() => setError(null)}>Dismiss</button></div>}

      {status && !status.detected && (
        <section className="eve-empty">
          <Orbit size={28} />
          <h2>No Eve agent detected</h2>
          <p>Open an Eve project containing an <code>eve</code> package dependency or an <code>agent/instructions.md</code> filesystem layout.</p>
          <small>Whim does not install or rewrite a project automatically.</small>
        </section>
      )}

      {status?.detected && (
        <>
          <section className="eve-status-grid">
            <article><span>Framework</span><strong>eve {status.packageVersion ?? "workspace"}</strong><small>{status.layout ?? "unresolved"} layout</small></article>
            <article><span>Local CLI</span><strong>{status.cliAvailable ? "Ready" : "Dependencies needed"}</strong><small>{status.cliPath ?? "Run the project package install first"}</small></article>
            <article><span>Compile</span><strong>{status.compileStatus ?? "Not validated"}</strong><small>{status.model ?? "Run eve info to resolve the model"}</small></article>
            <article><span>Diagnostics</span><strong>{status.diagnosticErrors ?? "—"} errors</strong><small>{status.diagnosticWarnings ?? "—"} warnings</small></article>
          </section>

          <div className="inline-notice eve-safety-note"><ShieldCheck size={14} /><span><strong>Explicit execution boundary:</strong> Run eve info only when you trust this workspace; Eve can compile project-authored TypeScript. Whim strips ambient provider credentials from that subprocess.</span></div>

          <section className="eve-instructions-card">
            <div><BookOpen size={17} /><span><strong>Always-on instructions</strong><small>{status.instructionsPath ?? "No instructions source discovered"}</small></span></div>
            <button className="secondary-action" type="button" disabled={!status.instructionsPath} onClick={() => status.instructionsPath && onOpenFile(status.instructionsPath)}><FileCode2 size={13} /> Open</button>
          </section>

          <section className="eve-slots">
            <SlotCard icon={Sparkles} title="Skills" files={status.skills} />
            <SlotCard icon={Wrench} title="Tools" files={status.tools} />
            <SlotCard icon={RadioTower} title="Channels" files={status.channels} />
            <SlotCard icon={CalendarClock} title="Schedules" files={status.schedules} />
            <SlotCard icon={FlaskConical} title="Evals" files={status.evals} />
          </section>

          {status.createRoute && (
            <section className="eve-routes">
              <div className="section-heading-row"><div><span className="section-kicker">Durable messaging contract</span><h2>Session routes</h2></div><span className="signed-note"><CheckCircle2 size={13} /> resolved by eve info</span></div>
              <code>POST {status.createRoute}</code>
              <code>POST {status.continueRoute}</code>
              <code>GET {status.streamRoute}</code>
            </section>
          )}
        </>
      )}
    </main>
  );
}

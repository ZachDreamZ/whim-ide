import { Gauge, Keyboard, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../../lib/bridge";
import { APP_VERSION } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = { settings: AppSettings; onChange: (next: AppSettings) => void; saving: boolean };

export function GeneralSettings({ settings, onChange, saving }: Props) {
  const update = (patch: Partial<AppSettings["general"]>) => onChange({ ...settings, general: { ...settings.general, ...patch } });
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "uptodate" | "error">("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const doCheck = useCallback(async () => {
    setUpdateStatus("checking");
    setUpdateError(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setUpdateVersion(update.version);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("uptodate");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // 404 from the update endpoint just means no release published yet
      if (msg.includes("404") || msg.includes("not found") || msg.includes("timeout")) {
        setUpdateStatus("uptodate");
      } else {
        setUpdateStatus("error");
        setUpdateError(msg || "Update check failed");
      }
    }
  }, []);

  const doInstall = useCallback(async () => {
    setInstalling(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
      }
    } catch {
      setInstalling(false);
    }
  }, []);

  // Auto-check once on mount
  useEffect(() => { void doCheck(); }, [doCheck]);

  return <div className="mx-auto max-w-[760px] px-10 py-12">
    <header className="mb-9"><h1 className="text-2xl font-medium text-white">General</h1><p className="mt-2 text-sm text-white/50">Window and composer behavior that applies immediately across Whim.</p></header>
    <section className="mb-8"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Gauge size={15}/> Interface</div><div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
      <SettingsRow label="Ambient suggestions" description="Show repository-aware starter prompts in an empty task conversation." control={{ type: "toggle", value: settings.general.suggestedPrompts, onChange: (suggestedPrompts) => update({ suggestedPrompts }) }}/>
      <SettingsRow label="Bottom status panel" description="Show live Git, native runtime, and workspace status at the bottom of Whim." control={{ type: "toggle", value: settings.general.showBottomPanel, onChange: (showBottomPanel) => update({ showBottomPanel }) }} borderBottom={false}/>
    </div></section>
    <section className="mb-8"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><RefreshCw size={15}/> Updates</div><div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
      {updateStatus === "checking" && <SettingsRow label="Checking for updates…" description="Contacting update server" control={{ type: "custom", node: <span className="text-xs text-white/40">Checking…</span> }} borderBottom={false} />}
      {updateStatus === "uptodate" && <SettingsRow label="Whim is up to date" description={`Version ${APP_VERSION}`} control={{ type: "custom", node: <button className="text-xs text-blue-400 hover:text-blue-300" onClick={doCheck}>Check again</button> }} borderBottom={false} />}
      {updateStatus === "available" && <SettingsRow label={`Update available: v${updateVersion}`} description="A new version is ready to install" control={{ type: "custom", node: <button className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded" onClick={doInstall} disabled={installing}>{installing ? "Installing…" : "Install now"}</button> }} borderBottom={false} />}
      {updateStatus === "error" && <SettingsRow label="Update check failed" description={updateError ?? "Could not reach update server"} control={{ type: "custom", node: <button className="text-xs text-blue-400 hover:text-blue-300" onClick={doCheck}>Retry</button> }} borderBottom={false} />}
      {updateStatus === "idle" && <SettingsRow label="Updates" description="Check for new versions of Whim" control={{ type: "custom", node: <button className="text-xs text-blue-400 hover:text-blue-300" onClick={doCheck}>Check for updates</button> }} borderBottom={false} />}
    </div></section>
    <section><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Keyboard size={15}/> Quick Chat</div><div className="rounded-xl border border-white/5 bg-white/[0.02] px-5"><SettingsRow label="Open Chat" description="Start a private, tool-free conversation from anywhere in Whim." control={{ type: "custom", node: <kbd className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-white/65">Ctrl Alt N</kbd> }} borderBottom={false}/></div></section>
    <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={13}/>{saving ? "Saving general settings…" : "Saved locally and applied to this window."}</p>
  </div>;
}

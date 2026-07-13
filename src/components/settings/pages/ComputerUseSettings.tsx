import { Monitor, ShieldCheck } from "lucide-react";
import type { AppSettings } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = { settings: AppSettings; onChange: (next: AppSettings) => void; saving: boolean };

export function ComputerUseSettings({ settings, onChange, saving }: Props) {
  const update = (patch: Partial<AppSettings["computerUse"]>) => onChange({ ...settings, computerUse: { ...settings.computerUse, ...patch } });
  return <div className="max-w-[700px] mx-auto px-10 py-12">
    <h1 className="flex items-center gap-2 text-2xl font-medium text-white"><Monitor size={21}/> Computer use</h1>
    <p className="mt-2 mb-8 text-sm text-white/50">These switches are enforced by Rust before Windows UI Automation or screenshot capture runs.</p>
    <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
      <SettingsRow label="Screen capture" description="Allow an explicit App Context > Screenshot action to save an image inside the selected workspace." control={{ type: "toggle", value: settings.computerUse.screenCapture, onChange: (screenCapture) => update({ screenCapture }) }}/>
      <SettingsRow label="VS Code and terminal context" description="Allow an explicit context action to read visible accessibility text from supported developer windows." control={{ type: "toggle", value: settings.computerUse.appContext, onChange: (appContext) => update({ appContext }) }} borderBottom={false}/>
    </div>
    <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={13}/>{saving ? "Saving privacy boundary…" : "Background desktop actions are not exposed until a resumable approval flow exists."}</p>
  </div>;
}

import { Gauge, Keyboard, ShieldCheck } from "lucide-react";
import type { AppSettings } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = { settings: AppSettings; onChange: (next: AppSettings) => void; saving: boolean };

export function GeneralSettings({ settings, onChange, saving }: Props) {
  const update = (patch: Partial<AppSettings["general"]>) => onChange({ ...settings, general: { ...settings.general, ...patch } });
  return <div className="mx-auto max-w-[760px] px-10 py-12">
    <header className="mb-9"><h1 className="text-2xl font-medium text-white">General</h1><p className="mt-2 text-sm text-white/50">Window and composer behavior that applies immediately across Whim.</p></header>
    <section className="mb-8"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Gauge size={15}/> Interface</div><div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
      <SettingsRow label="Ambient suggestions" description="Show repository-aware starter prompts in an empty task conversation." control={{ type: "toggle", value: settings.general.suggestedPrompts, onChange: (suggestedPrompts) => update({ suggestedPrompts }) }}/>
      <SettingsRow label="Bottom status panel" description="Show live Git, native runtime, and workspace status at the bottom of Whim." control={{ type: "toggle", value: settings.general.showBottomPanel, onChange: (showBottomPanel) => update({ showBottomPanel }) }} borderBottom={false}/>
    </div></section>
    <section><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Keyboard size={15}/> Quick Chat</div><div className="rounded-xl border border-white/5 bg-white/[0.02] px-5"><SettingsRow label="Open Chat" description="Start a private, tool-free conversation from anywhere in Whim." control={{ type: "custom", node: <kbd className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-white/65">Ctrl Alt N</kbd> }} borderBottom={false}/></div></section>
    <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={13}/>{saving ? "Saving general settings…" : "Saved locally and applied to this window."}</p>
  </div>;
}

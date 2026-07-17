import { ShieldCheck } from "lucide-react";
import type { AppSettings } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = { settings: AppSettings; onChange: (next: AppSettings) => void; saving: boolean };

const capabilityLabels: Record<string, { label: string; description: string }> = {
  research: { label: "Research fan-out", description: "Allow bounded, read-only parallel investigations with durable child tasks." },
  coding: { label: "Workspace coding", description: "Expose scoped write, edit, checkpoint, and rollback tools in mutating roles." },
  verification: { label: "Native verification", description: "Expose project-discovered checks and local preview evidence." },
  "computer-use": { label: "Windows desktop control", description: "Allow opt-in, accessibility-based inspection and invocation of visible Windows controls." },
};

export function ConfigurationSettings({ settings, onChange, saving }: Props) {
  const updateAgent = (patch: Partial<AppSettings["agent"]>) => onChange({ ...settings, agent: { ...settings.agent, ...patch } });
  const toggleCapability = (id: string, enabled: boolean) => {
    const current = settings.agent.enabledCapabilities;
    updateAgent({ enabledCapabilities: enabled ? [...new Set([...current, id])] : current.filter((item) => item !== id) });
  };

  return <div className="mx-auto max-w-[760px] px-10 py-12">
    <header className="mb-9"><h1 className="text-2xl font-medium text-white">Configuration</h1><p className="mt-2 text-sm text-white/50">Agent depth, approval policy, and capability controls enforced by Whim's native agent boundary.</p></header>
    <section className="mb-8">
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
        <SettingsRow label="Reasoning and execution depth" description="Controls native tool-iteration limits and reasoning effort." control={{ type: "select", value: settings.agent.speed, options: ["fast", "balanced", "thorough"], onChange: (speed) => updateAgent({ speed: speed as AppSettings["agent"]["speed"] }) }}/>
        <SettingsRow label="Approval policy" description={settings.agent.approvalPolicy === "always" ? "Mutating tools are withheld until Whim has a resumable approval UI." : "Workspace edits are allowed, while destructive commands and external side effects remain blocked natively."} control={{ type: "select", value: settings.agent.approvalPolicy, options: ["risky", "always"], onChange: (approvalPolicy) => updateAgent({ approvalPolicy: approvalPolicy as AppSettings["agent"]["approvalPolicy"] }) }}/>
        <SettingsRow label="Continuous verification" description="Run only project-discovered checks after agent edits and return bounded diagnostics to the model." control={{ type: "toggle", value: settings.agent.backgroundVerification, onChange: (backgroundVerification) => updateAgent({ backgroundVerification }) }}/>
        <SettingsRow label="Autonomous janitor" description="Create a low-priority cleanup candidate in an isolated Whim worktree while idle. It never auto-merges or pushes." control={{ type: "toggle", value: settings.agent.autonomousJanitor, onChange: (autonomousJanitor) => updateAgent({ autonomousJanitor }) }}/>
        <SettingsRow label="Compact capability catalog" description="Send inactive capabilities as one-line descriptions to reduce context use." control={{ type: "toggle", value: settings.agent.deferCapabilities, onChange: (deferCapabilities) => updateAgent({ deferCapabilities }) }}/>
        <SettingsRow label="Parallel research limit" description="Hard cap for independent child investigations spawned by one research call." control={{ type: "segmented", value: String(settings.agent.maxParallelAgents), options: ["1", "2", "4", "8"], onChange: (value) => updateAgent({ maxParallelAgents: Number(value) }) }} borderBottom={false}/>
      </div>
    </section>
    <section><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]">Capabilities</div><div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">{Object.entries(capabilityLabels).map(([id, item], index, entries) => <SettingsRow key={id} label={item.label} description={item.description} control={{ type: "toggle", value: settings.agent.enabledCapabilities.includes(id), onChange: (enabled) => toggleCapability(id, enabled) }} borderBottom={index !== entries.length - 1}/>)}</div></section>
    <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={13}/>{saving ? "Saving native configuration…" : "Saved in the local Whim application config directory."}</p>
  </div>;
}

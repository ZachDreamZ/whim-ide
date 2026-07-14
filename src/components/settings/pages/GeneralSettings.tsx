import { Bot, Gauge, Layers3, ShieldCheck } from "lucide-react";
import type { AppSettings } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  saving: boolean;
};

const capabilityLabels: Record<string, { label: string; description: string }> = {
  research: { label: "Research fan-out", description: "Allow bounded, read-only parallel investigations with durable child tasks." },
  coding: { label: "Workspace coding", description: "Expose scoped write, edit, checkpoint, and rollback tools in mutating roles." },
  verification: { label: "Native verification", description: "Expose project-discovered checks and local preview evidence." },
  "pi-delegation": { label: "Pi delegation", description: "Allow the installed Pi runtime and its global subagent tooling." },
};

export function GeneralSettings({ settings, onChange, saving }: Props) {
  const updateAgent = (patch: Partial<AppSettings["agent"]>) => onChange({ ...settings, agent: { ...settings.agent, ...patch } });
  const updateGeneral = (patch: Partial<AppSettings["general"]>) => onChange({ ...settings, general: { ...settings.general, ...patch } });
  const toggleCapability = (id: string, enabled: boolean) => {
    const current = settings.agent.enabledCapabilities;
    updateAgent({ enabledCapabilities: enabled ? [...new Set([...current, id])] : current.filter((item) => item !== id) });
  };

  return <div className="max-w-[760px] mx-auto px-10 py-12">
    <header className="mb-9">
      <h1 className="text-2xl font-medium text-white">Agent runtime</h1>
      <p className="mt-2 text-sm text-white/50">Every control below is persisted by Rust and changes the actual execution boundary.</p>
    </header>

    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Bot size={15}/> Runtime</div>
      <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
        <SettingsRow label="Execution engine" description={settings.agent.runtime === "pi" ? "Runs the installed Pi CLI as a hidden, cancellable subprocess using Pi's own credential store." : "Runs Whim's provider-neutral Rust agent loop and native tool boundary."} control={{ type: "select", value: settings.agent.runtime, options: ["native", "pi"], onChange: (runtime) => updateAgent({ runtime: runtime as AppSettings["agent"]["runtime"] }) }}/>
        {settings.agent.runtime === "pi" && (
          <SettingsRow
            label="Pi model"
            description="A model currently exposed by the installed Pi provider catalog."
            control={{
              type: "select",
              value: settings.agent.piModel,
              options: ["opencode/deepseek-v4-flash-free", "google/gemma-4-31b-it", "openrouter/google/gemma-4-31b-it:free", "opencode/big-pickle", "opencode/hy3-free"],
              onChange: (piModel) => updateAgent({ piModel }),
            }}
          />
        )}
        <SettingsRow label="Execution depth" description="Changes native tool-iteration limits and Pi reasoning effort." control={{ type: "select", value: settings.agent.speed, options: ["fast", "balanced", "thorough"], onChange: (speed) => updateAgent({ speed: speed as AppSettings["agent"]["speed"] }) }}/>
        <SettingsRow label="Sensitive tool policy" description={settings.agent.approvalPolicy === "always" ? "Mutating tools are withheld until Whim has a resumable approval UI." : "Workspace edits are allowed, while destructive commands and external side effects remain blocked natively."} control={{ type: "select", value: settings.agent.approvalPolicy, options: ["risky", "always"], onChange: (approvalPolicy) => updateAgent({ approvalPolicy: approvalPolicy as AppSettings["agent"]["approvalPolicy"] }) }}/>
        <SettingsRow label="Continuous verification" description="Run only project-discovered Cargo, build, and ESLint checks after agent edits, then append bounded diagnostics to the next model turn." control={{ type: "toggle", value: settings.agent.backgroundVerification, onChange: (backgroundVerification) => updateAgent({ backgroundVerification }) }}/>
        <SettingsRow label="Autonomous janitor" description="When the foreground is idle, create a low-priority cleanup candidate in an isolated Whim worktree. It never auto-merges or pushes." control={{ type: "toggle", value: settings.agent.autonomousJanitor, onChange: (autonomousJanitor) => updateAgent({ autonomousJanitor }) }}/>
        <SettingsRow label="Compact capability catalog" description="Send inactive capabilities as one-line descriptions instead of full runtime guidance to reduce context use." control={{ type: "toggle", value: settings.agent.deferCapabilities, onChange: (deferCapabilities) => updateAgent({ deferCapabilities }) }}/>
        <SettingsRow label="Parallel research limit" description="Hard cap for independent child investigations spawned by one research call." control={{ type: "segmented", value: String(settings.agent.maxParallelAgents), options: ["1", "2", "4", "8"], onChange: (value) => updateAgent({ maxParallelAgents: Number(value) }) }} borderBottom={false}/>
      </div>
    </section>

    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Layers3 size={15}/> Execution Environment</div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4">
        <div className="flex items-center justify-between gap-4"><span className="text-sm text-white/80">Windows native</span><span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-medium text-emerald-300">Active</span></div>
        <p className="mt-2 text-xs leading-relaxed text-white/40">Workspace tools currently execute through Whim's bounded PowerShell and filesystem backend. WSL, container, and remote adapters stay hidden until they have real runtime enforcement.</p>
      </div>
    </section>

    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Layers3 size={15}/> Capabilities</div>
      <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
        {Object.entries(capabilityLabels).map(([id, item], index, entries) => <SettingsRow key={id} label={item.label} description={item.description} control={{ type: "toggle", value: settings.agent.enabledCapabilities.includes(id), onChange: (enabled) => toggleCapability(id, enabled) }} borderBottom={index !== entries.length - 1}/>) }
      </div>
    </section>

    <section>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Gauge size={15}/> Interface</div>
      <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
        <SettingsRow label="Suggested prompts" description="Show repository-aware starter prompts in an empty Mission Control session." control={{ type: "toggle", value: settings.general.suggestedPrompts, onChange: (suggestedPrompts) => updateGeneral({ suggestedPrompts }) }}/>
        <SettingsRow label="Bottom status panel" description="Show live Git, native runtime, and workspace status at the bottom of Whim." control={{ type: "toggle", value: settings.general.showBottomPanel, onChange: (showBottomPanel) => updateGeneral({ showBottomPanel }) }} borderBottom={false}/>
      </div>
    </section>

    <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={13}/>{saving ? "Saving native configuration…" : "Saved in the local Whim application config directory."}</p>
  </div>;
}

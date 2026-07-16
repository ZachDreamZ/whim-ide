import { useCallback, useEffect, useState } from "react";
import { Bot, Layers3, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { bridge, type AppSettings, type ExternalHarnessStatus } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = { settings: AppSettings; onChange: (next: AppSettings) => void; saving: boolean };

const capabilityLabels: Record<string, { label: string; description: string }> = {
  research: { label: "Research fan-out", description: "Allow bounded, read-only parallel investigations with durable child tasks." },
  coding: { label: "Workspace coding", description: "Expose scoped write, edit, checkpoint, and rollback tools in mutating roles." },
  verification: { label: "Native verification", description: "Expose project-discovered checks and local preview evidence." },
  "computer-use": { label: "Windows desktop control", description: "Allow opt-in, accessibility-based inspection and invocation of visible Windows controls." },
  "pi-delegation": { label: "Pi delegation", description: "Allow the installed Pi runtime and its global subagent tooling." },
  "external-harnesses": { label: "External agent runtimes", description: "Allow subscription CLIs and local Eve durable sessions without exposing provider tokens to Whim." },
};

const runtimeDescription: Record<AppSettings["agent"]["runtime"], string> = {
  native: "Runs Whim's provider-neutral Rust agent loop and native tool boundary.",
  pi: "Runs the installed Pi CLI as a hidden, cancellable subprocess using Pi's own credential store.",
  codex: "Runs Codex non-interactively through its own ChatGPT subscription login; Whim keeps the workspace lease and sandbox.",
  claude: "Runs Claude Code in a subscription-backed, bare read-only mode for research and review; Codex remains the sandboxed editing adapter.",
  antigravity: "Runs Google Antigravity through its OS-keyring Google AI Pro login in sandboxed, read-only plan mode.",
  eve: "Connects Mission Control to this project's loopback Eve server and preserves its durable session continuation across turns.",
};

export function ConfigurationSettings({ settings, onChange, saving }: Props) {
  const [harnesses, setHarnesses] = useState<ExternalHarnessStatus[]>([]);
  const [loadingHarnesses, setLoadingHarnesses] = useState(false);
  const updateAgent = (patch: Partial<AppSettings["agent"]>) => onChange({ ...settings, agent: { ...settings.agent, ...patch } });
  const toggleCapability = (id: string, enabled: boolean) => {
    const current = settings.agent.enabledCapabilities;
    updateAgent({ enabledCapabilities: enabled ? [...new Set([...current, id])] : current.filter((item) => item !== id) });
  };
  const refreshHarnesses = useCallback(async () => {
    if (!bridge.isNative()) return;
    setLoadingHarnesses(true);
    try { setHarnesses(await bridge.externalHarnesses()); }
    catch { setHarnesses([]); }
    finally { setLoadingHarnesses(false); }
  }, []);
  useEffect(() => { void refreshHarnesses(); }, [refreshHarnesses]);

  return <div className="mx-auto max-w-[760px] px-10 py-12">
    <header className="mb-9"><h1 className="text-2xl font-medium text-white">Configuration</h1><p className="mt-2 text-sm text-white/50">Runtime, approval, reasoning depth, and capability controls enforced by the native agent boundary.</p></header>
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Bot size={15}/> Agent runtime</div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
        <SettingsRow label="Execution engine" description={runtimeDescription[settings.agent.runtime]} control={{ type: "select", value: settings.agent.runtime, options: ["native", "pi", "codex", "claude", "antigravity", "eve"], onChange: (runtime) => updateAgent({ runtime: runtime as AppSettings["agent"]["runtime"] }) }}/>
        {settings.agent.runtime === "pi" && (
          <SettingsRow
            label="Pi model"
            description="A model exposed by the installed Pi provider catalog."
            control={{
              type: "select",
              value: settings.agent.piModel,
              options: [
                "opencode/deepseek-v4-flash-free",
                "google/gemma-4-31b-it",
                "openrouter/google/gemma-4-31b-it:free",
                "opencode/big-pickle",
                "opencode/hy3-free",
              ],
              onChange: (piModel) => updateAgent({ piModel }),
            }}
          />
        )}
        {(settings.agent.runtime === "codex" || settings.agent.runtime === "claude" || settings.agent.runtime === "antigravity") && (
          <SettingsRow label="External model override" description="Leave as default to use the model selected by the authenticated harness." control={{ type: "input", value: settings.agent.externalModel, placeholder: "default", onChange: (externalModel) => updateAgent({ externalModel }) }}/>
        )}
        <SettingsRow label="Reasoning and execution depth" description="Changes native tool-iteration limits and Pi reasoning effort." control={{ type: "select", value: settings.agent.speed, options: ["fast", "balanced", "thorough"], onChange: (speed) => updateAgent({ speed: speed as AppSettings["agent"]["speed"] }) }}/>
        <SettingsRow label="Approval policy" description={settings.agent.approvalPolicy === "always" ? "Mutating tools are withheld until Whim has a resumable approval UI." : "Workspace edits are allowed, while destructive commands and external side effects remain blocked natively."} control={{ type: "select", value: settings.agent.approvalPolicy, options: ["risky", "always"], onChange: (approvalPolicy) => updateAgent({ approvalPolicy: approvalPolicy as AppSettings["agent"]["approvalPolicy"] }) }}/>
        <SettingsRow label="Continuous verification" description="Run only project-discovered checks after agent edits and return bounded diagnostics to the model." control={{ type: "toggle", value: settings.agent.backgroundVerification, onChange: (backgroundVerification) => updateAgent({ backgroundVerification }) }}/>
        <SettingsRow label="Autonomous janitor" description="Create a low-priority cleanup candidate in an isolated Whim worktree while idle. It never auto-merges or pushes." control={{ type: "toggle", value: settings.agent.autonomousJanitor, onChange: (autonomousJanitor) => updateAgent({ autonomousJanitor }) }}/>
        <SettingsRow label="Compact capability catalog" description="Send inactive capabilities as one-line descriptions to reduce context use." control={{ type: "toggle", value: settings.agent.deferCapabilities, onChange: (deferCapabilities) => updateAgent({ deferCapabilities }) }}/>
        <SettingsRow label="Parallel research limit" description="Hard cap for independent child investigations spawned by one research call." control={{ type: "segmented", value: String(settings.agent.maxParallelAgents), options: ["1", "2", "4", "8"], onChange: (value) => updateAgent({ maxParallelAgents: Number(value) }) }} borderBottom={false}/>
      </div>
    </section>
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold text-[#ececf1]"><span className="flex items-center gap-2"><Bot size={15}/> External harnesses</span><button type="button" className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/50 hover:bg-white/5 hover:text-white" onClick={() => void refreshHarnesses()} disabled={loadingHarnesses}>{loadingHarnesses ? <LoaderCircle className="animate-spin" size={13}/> : <RefreshCw size={13}/>} Refresh</button></div>
      <div className="grid gap-2 sm:grid-cols-2">
        {harnesses.map((harness) => <article key={harness.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4"><div className="flex items-start justify-between gap-3"><div><strong className="text-sm text-white/90">{harness.name}</strong><p className="mt-1 text-[11px] text-white/35">{harness.version ?? "Not installed"}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${harness.authenticated ? "bg-emerald-400/10 text-emerald-300" : harness.available ? "bg-amber-400/10 text-amber-200" : "bg-white/5 text-white/35"}`}>{harness.authenticated ? harness.authKind : harness.available ? "Login needed" : "Unavailable"}</span></div><p className="mt-3 text-xs leading-relaxed text-white/45">{harness.setupHint}</p><div className="mt-3 flex flex-wrap gap-1">{harness.capabilities.map((capability) => <span key={capability} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/35">{capability}</span>)}</div></article>)}
        {!loadingHarnesses && harnesses.length === 0 && <p className="col-span-full rounded-xl border border-white/5 p-4 text-xs text-white/40">Harness discovery is available in the installed Windows app.</p>}
      </div>
    </section>
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Layers3 size={15}/> Execution environment</div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5 py-4"><div className="flex items-center justify-between gap-4"><span className="text-sm text-white/80">Windows native</span><span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-medium text-emerald-300">Active</span></div><p className="mt-2 text-xs leading-relaxed text-white/40">Workspace tools execute through Whim's bounded PowerShell and filesystem backend. Unenforced adapters remain unavailable.</p></div>
    </section>
    <section><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Layers3 size={15}/> Capabilities</div><div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">{Object.entries(capabilityLabels).map(([id, item], index, entries) => <SettingsRow key={id} label={item.label} description={item.description} control={{ type: "toggle", value: settings.agent.enabledCapabilities.includes(id), onChange: (enabled) => toggleCapability(id, enabled) }} borderBottom={index !== entries.length - 1}/>)}</div></section>
    <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={13}/>{saving ? "Saving native configuration…" : "Saved in the local Whim application config directory."}</p>
  </div>;
}

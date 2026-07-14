import { useEffect, useState } from "react";
import { Brain, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { AppSettings } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  saving: boolean;
};

export function PersonalizationSettings({ settings, onChange, saving }: Props) {
  const [instructions, setInstructions] = useState(settings.personalization.customInstructions);
  const update = (patch: Partial<AppSettings["personalization"]>) => onChange({
    ...settings,
    personalization: { ...settings.personalization, ...patch },
  });

  useEffect(() => {
    setInstructions(settings.personalization.customInstructions);
  }, [settings.personalization.customInstructions]);

  const saveInstructions = () => {
    if (instructions !== settings.personalization.customInstructions) {
      update({ customInstructions: instructions });
    }
  };

  return <div className="mx-auto max-w-[760px] px-10 py-12">
    <header className="mb-9">
      <h1 className="flex items-center gap-2 text-2xl font-medium text-white"><SlidersHorizontal size={21}/> Personalization</h1>
      <p className="mt-2 text-sm text-white/50">Persistent preferences are applied by the native agent to every provider and can be disabled at any time.</p>
    </header>

    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Brain size={15}/> Response preferences</div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
        <SettingsRow
          label="Enable personalization"
          description="Apply your response style and custom instructions to future Vibe runs."
          control={{ type: "toggle", value: settings.personalization.enabled, onChange: (enabled) => update({ enabled }) }}
        />
        <SettingsRow
          label="Response style"
          description={settings.personalization.enabled ? "Changes how Whim explains and formats responses without changing tool permissions." : "Saved but ignored while personalization is off."}
          control={{
            type: "select",
            value: settings.personalization.responseStyle,
            options: ["normal", "concise", "formal", "explanatory"],
            onChange: (responseStyle) => update({ responseStyle: responseStyle as AppSettings["personalization"]["responseStyle"] }),
          }}
          borderBottom={false}
        />
      </div>
    </section>

    <section className="mb-8">
      <label htmlFor="whim-custom-instructions" className="mb-3 block text-sm font-semibold text-[#ececf1]">Custom instructions</label>
      <p className="mb-3 text-[13px] leading-relaxed text-[#a3a3a3]">Add stable preferences, terminology, or response conventions. Current requests and native safety boundaries always take priority.</p>
      <textarea
        id="whim-custom-instructions"
        aria-label="Custom instructions"
        value={instructions}
        disabled={!settings.personalization.enabled}
        maxLength={8_000}
        onChange={(event) => setInstructions(event.target.value)}
        onBlur={saveInstructions}
        placeholder="For example: Prefer concise explanations and show exact verification evidence."
        className="min-h-40 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-[#ececf1] outline-none transition-colors placeholder:text-white/25 focus:border-white/25 disabled:cursor-not-allowed disabled:opacity-45"
      />
      <div className="mt-2 flex justify-between text-xs text-white/35"><span>Saved on blur</span><span>{instructions.length.toLocaleString()} / 8,000</span></div>
    </section>

    <section>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><ShieldCheck size={15}/> Memory and privacy</div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
        <SettingsRow
          label="Use project memory"
          description="Allow agents to read bounded repository guidance and the local observation ledger, and append successful mission summaries. Turn this off for a memory-free run."
          control={{ type: "toggle", value: settings.personalization.projectMemory, onChange: (projectMemory) => update({ projectMemory }) }}
          borderBottom={false}
        />
      </div>
    </section>

    <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={13}/>{saving ? "Saving personalization…" : "Stored only in Whim's local native configuration."}</p>
  </div>;
}

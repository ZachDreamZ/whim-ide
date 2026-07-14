import { Keyboard, MessageSquareText, ShieldCheck } from "lucide-react";
import type { AppSettings } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  saving: boolean;
};

export function ChatSettings({ settings, onChange, saving }: Props) {
  const update = (patch: Partial<AppSettings["chat"]>) => onChange({
    ...settings,
    chat: { ...settings.chat, ...patch },
  });

  return <div className="mx-auto max-w-[760px] px-10 py-12">
    <header className="mb-9">
      <h1 className="flex items-center gap-2 text-2xl font-medium text-white"><MessageSquareText size={21}/> Chat</h1>
      <p className="mt-2 text-sm text-white/50">Composer and transcript controls apply immediately to Mission Control.</p>
    </header>

    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#ececf1]"><Keyboard size={15}/> Composer</div>
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">
        <SettingsRow
          label="Enter sends message"
          description={settings.chat.enterToSend ? "Enter sends; Shift+Enter inserts a new line." : "Enter inserts a new line; Ctrl+Enter sends."}
          control={{ type: "toggle", value: settings.chat.enterToSend, onChange: (enterToSend) => update({ enterToSend }) }}
        />
        <SettingsRow
          label="Copy actions"
          description="Show copy controls for user and assistant text in the transcript."
          control={{ type: "toggle", value: settings.chat.showCopyActions, onChange: (showCopyActions) => update({ showCopyActions }) }}
          borderBottom={false}
        />
      </div>
    </section>

    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
      <h2 className="text-sm font-medium text-white">Local session behavior</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-white/45">The visible transcript lives only in the current app session. “New session” clears it and starts a fresh native agent session.</p>
    </div>

    <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={13}/>{saving ? "Saving chat preferences…" : "Composer preferences are stored locally."}</p>
  </div>;
}

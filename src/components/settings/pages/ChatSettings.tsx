import { useState } from "react";
import { History, Keyboard, MessageSquareText, ShieldCheck, Trash2 } from "lucide-react";
import type { AppSettings } from "../../../lib/bridge";
import { bridge, errorMessage } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  saving: boolean;
};

export function ChatSettings({ settings, onChange, saving }: Props) {
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
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
        />
        <SettingsRow
          label="Save chat history"
          description="Keep lightweight Chat conversations in Whim's local native configuration so Recent chats survives restarts."
          control={{ type: "toggle", value: settings.chat.persistHistory, onChange: (persistHistory) => update({ persistHistory }) }}
          borderBottom={false}
        />
      </div>
    </section>

    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-white"><History size={14}/> Local chat data</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-white/45">Chat history is stored locally and never grants workspace tools. Mission Control task transcripts continue to use the durable task ledger.</p>
      <button className="secondary-action mt-4" type="button" onClick={() => {
        if (!window.confirm("Delete all local Whim Chat conversations?")) return;
        void bridge.clearChatThreads().then(() => setHistoryMessage("Chat history cleared.")).catch((cause) => setHistoryMessage(errorMessage(cause)));
      }}><Trash2 size={13}/> Clear chat history</button>
      {historyMessage && <p className="mt-3 text-xs text-white/50" role="status">{historyMessage}</p>}
    </div>

    <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><ShieldCheck size={13}/>{saving ? "Saving chat preferences…" : "Composer preferences are stored locally."}</p>
  </div>;
}

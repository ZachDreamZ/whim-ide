import type { AppSettings } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = { settings: AppSettings; onChange: (next: AppSettings) => void; saving: boolean };

export function VoiceSettings({ settings, onChange, saving }: Props) {
  const update = (patch: Partial<AppSettings["voice"]>) => onChange({ ...settings, voice: { ...settings.voice, ...patch } });
  return <div className="max-w-[700px] mx-auto px-10 py-12">
    <h1 className="text-2xl font-medium text-white">Voice</h1>
    <p className="mt-2 mb-8 text-sm text-white/50">Selections are sent to the real transcription and speech endpoints.</p>
    <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
      <SettingsRow label="Speech voice" description="OpenAI-compatible voice ID used for spoken responses." control={{ type: "select", value: settings.voice.voice, options: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"], onChange: (voice) => update({ voice: voice as AppSettings["voice"]["voice"] }) }}/>
      <SettingsRow label="Transcription language" description="A concrete ISO language improves recognition; auto leaves detection to the provider." control={{ type: "select", value: settings.voice.language, options: ["auto", "en", "es", "fr", "de", "ja", "zh"], onChange: (language) => update({ language: language as AppSettings["voice"]["language"] }) }} borderBottom={false}/>
    </div>
    <p className="mt-5 text-xs text-white/40">{saving ? "Saving voice settings…" : "Raw microphone audio is never written to the settings file."}</p>
  </div>;
}

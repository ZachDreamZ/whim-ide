import { useEffect, useState } from "react";
import type { AppSettings } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = { settings: AppSettings; onChange: (next: AppSettings) => void; saving: boolean };

export function VoiceSettings({ settings, onChange, saving }: Props) {
  const [dictionary, setDictionary] = useState(settings.voice.dictionary);
  const update = (patch: Partial<AppSettings["voice"]>) => onChange({ ...settings, voice: { ...settings.voice, ...patch } });
  useEffect(() => setDictionary(settings.voice.dictionary), [settings.voice.dictionary]);
  return <div className="max-w-[700px] mx-auto px-10 py-12">
    <h1 className="text-2xl font-medium text-white">Voice</h1>
    <p className="mt-2 mb-8 text-sm text-white/50">Selections are sent to the real transcription and speech endpoints.</p>
    <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
      <SettingsRow label="Speech voice" description="OpenAI-compatible voice ID used for spoken responses." control={{ type: "select", value: settings.voice.voice, options: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"], onChange: (voice) => update({ voice: voice as AppSettings["voice"]["voice"] }) }}/>
      <SettingsRow label="Transcription language" description="A concrete ISO language improves recognition; auto leaves detection to the provider." control={{ type: "select", value: settings.voice.language, options: ["auto", "en", "es", "fr", "de", "ja", "zh"], onChange: (language) => update({ language: language as AppSettings["voice"]["language"] }) }} borderBottom={false}/>
    </div>
    <label htmlFor="whim-dictation-dictionary" className="mt-8 mb-3 block text-sm font-semibold text-[#ececf1]">Dictation dictionary</label>
    <p className="mb-3 text-[13px] leading-relaxed text-white/45">Add names, technical terms, or preferred spellings. This bounded text is sent as the transcription prompt, never as audio history.</p>
    <textarea id="whim-dictation-dictionary" value={dictionary} maxLength={1_000} onChange={(event) => setDictionary(event.target.value)} onBlur={() => { if (dictionary !== settings.voice.dictionary) update({ dictionary }); }} placeholder="Whim, Tauri, Rust, project-specific names…" className="min-h-28 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-[#ececf1] outline-none placeholder:text-white/25 focus:border-white/25" />
    <div className="mt-2 flex justify-between text-xs text-white/35"><span>Sent only when you transcribe</span><span>{dictionary.length.toLocaleString()} / 1,000</span></div>
    <p className="mt-5 text-xs text-white/40">{saving ? "Saving voice settings…" : "Raw microphone audio is never written to the settings file."}</p>
  </div>;
}

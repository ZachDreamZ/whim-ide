import { useState } from "react";
import { SettingsRow } from "../SettingsRow";

export function VoiceSettings() {
  const [voice, setVoice] = useState("Cove");
  const [lang, setLang] = useState("Auto-Detect");
  
  return (
    <div className="max-w-[700px] mx-auto px-10 py-12">
      <h1 className="text-2xl font-medium text-white mb-10">Voice</h1>

      <div className="mb-10">
        <h2 className="text-sm font-semibold text-[#ececf1] mb-3">Voice settings</h2>
        <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
          <SettingsRow 
            label="Voice" 
            description="Choose the voice Whim IDE will use for responses"
            control={{ type: "select", value: voice, options: ["Cove", "Juniper", "Breeze", "Ember"], onChange: setVoice }}
          />
          <SettingsRow 
            label="Main Language" 
            description="Choose the language for voice recognition"
            control={{ type: "select", value: lang, options: ["Auto-Detect", "English", "Spanish", "French"], onChange: setLang }}
            borderBottom={false}
          />
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { SettingsRow } from "../SettingsRow";
export function ComputerUseSettings() {
  const [screen, setScreen] = useState(true); const [apps, setApps] = useState(true); const [actions, setActions] = useState(false);
  return <div className="flex flex-col h-full overflow-y-auto pr-4 pb-8"><h2 className="text-xl font-semibold text-white mb-2">Computer Use (Work with Apps)</h2><p className="text-sm text-white/50 mb-6">Allow Whim to interact with your native desktop environment.</p><div className="bg-white/5 rounded-xl border border-white/5 px-4"><SettingsRow label="Screen Recording Access" description="Allow screenshot context when invoked." control={{ type: "toggle", value: screen, onChange: setScreen }}/><SettingsRow label="Terminal & VS Code Integration" description="Allow explicit context-menu reads from active developer tools." control={{ type: "toggle", value: apps, onChange: setApps }}/><SettingsRow label="Background OS Actions" description="Allow explicitly approved UI automation actions." control={{ type: "toggle", value: actions, onChange: setActions }} borderBottom={false}/></div></div>;
}

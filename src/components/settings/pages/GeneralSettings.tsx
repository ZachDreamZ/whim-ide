import { useState } from "react";
import { SettingsRow } from "../SettingsRow";

export function GeneralSettings() {
  const [defaultPermissions, setDefaultPermissions] = useState(false);
  const [autoReview, setAutoReview] = useState(true);
  const [fullAccess, setFullAccess] = useState(false);

  const [fileOpenDest, setFileOpenDest] = useState("VS Code");
  const [agentEnv, setAgentEnv] = useState("Windows native");
  const [terminalShell, setTerminalShell] = useState("PowerShell");
  const [language, setLanguage] = useState("Auto detect");
  const [bottomPanel, setBottomPanel] = useState(true);
  const [terminalLocation, setTerminalLocation] = useState("Bottom");
  const [speed, setSpeed] = useState("Fast");
  const [suggestedPrompts, setSuggestedPrompts] = useState(true);

  return (
    <div className="max-w-[700px] mx-auto px-10 py-12">
      <h1 className="text-2xl font-medium text-white mb-10">General</h1>

      <div className="mb-10">
        <h2 className="text-sm font-semibold text-[#ececf1] mb-3">Permissions</h2>
        <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
          <SettingsRow 
            label="Default permissions" 
            description="By default, Whim IDE can read and edit files in its workspace. It can ask for additional access when needed"
            control={{ type: "toggle", value: defaultPermissions, onChange: setDefaultPermissions }}
          />
          <SettingsRow 
            label="Auto-review" 
            description="Whim IDE automatically reviews requests for additional access. Auto-review can make mistakes."
            control={{ type: "toggle", value: autoReview, onChange: setAutoReview }}
          >
            <a href="#" className="text-[#3498db] hover:underline">Learn more</a> about elevated risks.
          </SettingsRow>
          <SettingsRow 
            label="Full access" 
            description="When Whim IDE runs with full access, it can edit any file on your computer and run commands with network, without your approval. This significantly increases the risk of data loss, leaks, or unexpected behavior."
            control={{ type: "toggle", value: fullAccess, onChange: setFullAccess }}
            borderBottom={false}
          >
            <a href="#" className="text-[#3498db] hover:underline">Learn more</a> about elevated risks.
          </SettingsRow>
        </div>
      </div>

      <div className="mb-10">
        <h2 className="text-sm font-semibold text-[#ececf1] mb-3">General</h2>
        <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
          <SettingsRow 
            label="Default file open destination" 
            description="Where files and folders open by default"
            control={{ type: "select", value: fileOpenDest, options: ["VS Code", "Cursor", "System default"], onChange: setFileOpenDest }}
          />
          <SettingsRow 
            label="Agent environment" 
            description="Choose where the agent runs on Windows"
            control={{ type: "select", value: agentEnv, options: ["Windows native", "WSL", "Docker"], onChange: setAgentEnv }}
          />
          <SettingsRow 
            label="Integrated terminal shell" 
            description="Choose which shell opens in the integrated terminal."
            control={{ type: "select", value: terminalShell, options: ["PowerShell", "Command Prompt", "Git Bash"], onChange: setTerminalShell }}
          />
          <SettingsRow 
            label="Language" 
            description="Language for the app UI"
            control={{ type: "select", value: language, options: ["Auto detect", "English", "Spanish", "French"], onChange: setLanguage }}
          />
          <SettingsRow 
            label="Bottom panel" 
            description="Show the bottom panel control in the app header"
            control={{ type: "toggle", value: bottomPanel, onChange: setBottomPanel }}
          />
          <SettingsRow 
            label="Default terminal location" 
            description="Choose where the terminal shortcut and environment actions open terminal tabs"
            control={{ type: "segmented", value: terminalLocation, options: ["Bottom", "Right"], onChange: setTerminalLocation }}
          />
          <SettingsRow 
            label="Speed" 
            description="Choose how quickly Whim runs across tasks, subagents, and compaction"
            control={{ type: "select", value: speed, options: ["Fast", "Balanced", "Thorough"], onChange: setSpeed }}
          />
          <SettingsRow 
            label="Suggested prompts" 
            description="Suggest what to do next by searching project files and connected apps"
            control={{ type: "toggle", value: suggestedPrompts, onChange: setSuggestedPrompts }}
            borderBottom={false}
          />
        </div>
      </div>
    </div>
  );
}

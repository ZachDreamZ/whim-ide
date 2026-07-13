import { useState } from "react";
import { SettingsRow } from "../SettingsRow";

export function AppearanceSettings() {
  const [theme, setTheme] = useState("System");
  
  const [lightAccent] = useState("#339CFF");
  const [lightBg] = useState("#FFFFFF");
  const [lightFg] = useState("#1A1C1F");
  const [lightUIFont, setLightUIFont] = useState("-apple-system, BlinkM");
  const [lightCodeFont, setLightCodeFont] = useState("ui-monospace, SFMo");
  const [lightContrast, setLightContrast] = useState(45);

  const [darkAccent] = useState("#339CFF");
  const [darkBg] = useState("#181818");

  return (
    <div className="max-w-[700px] mx-auto px-10 py-12">
      <h1 className="text-2xl font-medium text-white mb-10">Appearance</h1>

      <div className="mb-12">
        <h2 className="text-sm font-semibold text-[#ececf1] mb-4">Theme</h2>
        <div className="flex gap-4">
          <button 
            onClick={() => setTheme("System")}
            className="flex flex-col items-center gap-2 group cursor-pointer"
          >
            <div className={`w-[120px] h-[80px] rounded-lg border-2 ${theme === "System" ? "border-white" : "border-transparent group-hover:border-white/30"} overflow-hidden flex`}>
              <div className="w-1/2 bg-white p-2 flex flex-col gap-1.5 opacity-90"><div className="w-full h-1.5 bg-gray-200 rounded-full"/><div className="w-3/4 h-1.5 bg-gray-200 rounded-full"/><div className="w-5/6 h-1.5 bg-gray-200 rounded-full"/></div>
              <div className="w-1/2 bg-[#181818] p-2 flex flex-col gap-1.5 opacity-90"><div className="w-full h-1.5 bg-gray-700 rounded-full"/><div className="w-3/4 h-1.5 bg-gray-700 rounded-full"/><div className="w-5/6 h-1.5 bg-gray-700 rounded-full"/></div>
            </div>
            <span className={`text-xs ${theme === "System" ? "text-white" : "text-[#a3a3a3]"}`}>System</span>
          </button>
          
          <button 
            onClick={() => setTheme("Light")}
            className="flex flex-col items-center gap-2 group cursor-pointer"
          >
            <div className={`w-[120px] h-[80px] rounded-lg border-2 ${theme === "Light" ? "border-white" : "border-transparent group-hover:border-white/30"} overflow-hidden bg-white p-3 flex flex-col gap-2`}>
               <div className="w-full h-2 bg-gray-200 rounded-full"/>
               <div className="w-3/4 h-2 bg-gray-200 rounded-full"/>
               <div className="w-5/6 h-2 bg-gray-200 rounded-full"/>
            </div>
            <span className={`text-xs ${theme === "Light" ? "text-white" : "text-[#a3a3a3]"}`}>Light</span>
          </button>

          <button 
            onClick={() => setTheme("Dark")}
            className="flex flex-col items-center gap-2 group cursor-pointer"
          >
            <div className={`w-[120px] h-[80px] rounded-lg border-2 ${theme === "Dark" ? "border-white" : "border-transparent group-hover:border-white/30"} overflow-hidden bg-[#181818] p-3 flex flex-col gap-2 border-white/10`}>
               <div className="w-full h-2 bg-gray-700 rounded-full"/>
               <div className="w-3/4 h-2 bg-gray-700 rounded-full"/>
               <div className="w-5/6 h-2 bg-gray-700 rounded-full"/>
            </div>
            <span className={`text-xs ${theme === "Dark" ? "text-white" : "text-[#a3a3a3]"}`}>Dark</span>
          </button>
        </div>
      </div>

      <div className="mb-10">
        <div className="bg-[#171717] rounded-xl border border-white/10 overflow-hidden flex font-mono text-[11px] leading-relaxed">
          <div className="flex-1 p-4 border-r border-white/5">
            <div className="text-[#a3a3a3]"><span className="mr-3 select-none">1</span><span className="text-[#c678dd]">const</span> <span className="text-[#e5c07b]">themePreview</span>: <span className="text-[#56b6c2]">ThemeConfig</span> = {'{'}</div>
            <div className="bg-red-500/20 text-[#a3a3a3] -mx-4 px-4 border-l-2 border-red-500"><span className="mr-3 select-none text-red-500">2</span>surface: <span className="text-[#98c379]">"sidebar"</span>,</div>
            <div className="bg-red-500/20 text-[#a3a3a3] -mx-4 px-4 border-l-2 border-red-500"><span className="mr-3 select-none text-red-500">3</span>accent: <span className="text-[#98c379]">"#2563eb"</span>,</div>
            <div className="bg-red-500/20 text-[#a3a3a3] -mx-4 px-4 border-l-2 border-red-500"><span className="mr-3 select-none text-red-500">4</span>contrast: <span className="text-[#d19a66]">42</span>,</div>
            <div className="text-[#a3a3a3]"><span className="mr-3 select-none">5</span>{'}'};</div>
          </div>
          <div className="flex-1 p-4 bg-[#111111]">
            <div className="text-[#a3a3a3]"><span className="mr-3 select-none">1</span><span className="text-[#c678dd]">const</span> <span className="text-[#e5c07b]">themePreview</span>: <span className="text-[#56b6c2]">ThemeConfig</span> = {'{'}</div>
            <div className="bg-green-500/20 text-[#a3a3a3] -mx-4 px-4 border-l-2 border-green-500"><span className="mr-3 select-none text-green-500">2</span>surface: <span className="text-[#98c379]">"sidebar-elevated"</span>,</div>
            <div className="bg-green-500/20 text-[#a3a3a3] -mx-4 px-4 border-l-2 border-green-500"><span className="mr-3 select-none text-green-500">3</span>accent: <span className="text-[#98c379]">"#0ea5e9"</span>,</div>
            <div className="bg-green-500/20 text-[#a3a3a3] -mx-4 px-4 border-l-2 border-green-500"><span className="mr-3 select-none text-green-500">4</span>contrast: <span className="text-[#d19a66]">68</span>,</div>
            <div className="text-[#a3a3a3]"><span className="mr-3 select-none">5</span>{'}'};</div>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
          <div className="flex items-center justify-between py-4 border-b border-white/5">
            <h2 className="text-sm font-semibold text-[#ececf1]">Light theme</h2>
            <div className="flex items-center gap-4 text-xs text-[#a3a3a3]">
              <button className="hover:text-white">Import</button>
              <button className="hover:text-white">Copy theme</button>
              <div className="relative">
                <select className="appearance-none bg-white/5 border border-white/10 rounded-md pl-8 pr-8 py-1.5 text-xs outline-none text-white min-w-[120px]">
                  <option>Codex</option>
                  <option>Default</option>
                </select>
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full flex items-center justify-center text-[8px] font-bold text-black font-serif">Aa</span>
              </div>
            </div>
          </div>
          
          <SettingsRow label="Accent" control={{ type: "toggle", value: false, onChange: () => {} }}>
            <div className="w-[120px] h-7 bg-[#339CFF] rounded text-white flex items-center justify-center text-xs ml-auto font-mono">{lightAccent}</div>
          </SettingsRow>
          
          <SettingsRow label="Background" control={{ type: "toggle", value: false, onChange: () => {} }}>
            <div className="w-[120px] h-7 bg-[#FFFFFF] rounded text-black flex items-center justify-center text-xs ml-auto font-mono">{lightBg}</div>
          </SettingsRow>
          
          <SettingsRow label="Foreground" control={{ type: "toggle", value: false, onChange: () => {} }}>
            <div className="w-[120px] h-7 bg-[#1A1C1F] rounded border border-white/20 text-white flex items-center justify-center text-xs ml-auto font-mono">{lightFg}</div>
          </SettingsRow>
          
          <SettingsRow label="UI font" control={{ type: "toggle", value: false, onChange: () => {} }}>
             <input type="text" value={lightUIFont} onChange={e => setLightUIFont(e.target.value)} className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-xs text-white w-[200px] outline-none text-right" />
          </SettingsRow>
          
          <SettingsRow label="Code font" control={{ type: "toggle", value: false, onChange: () => {} }}>
             <input type="text" value={lightCodeFont} onChange={e => setLightCodeFont(e.target.value)} className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-xs text-white w-[200px] outline-none text-right" />
          </SettingsRow>
          
          <SettingsRow label="Contrast" control={{ type: "toggle", value: false, onChange: () => {} }} borderBottom={false}>
             <div className="flex items-center gap-4">
               <input type="range" min="0" max="100" value={lightContrast} onChange={e => setLightContrast(parseInt(e.target.value))} className="w-[160px] accent-white" />
               <span className="text-white font-mono w-6">{lightContrast}</span>
             </div>
          </SettingsRow>
        </div>
      </div>

      <div className="mb-6">
        <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
          <div className="flex items-center justify-between py-4 border-b border-white/5">
            <h2 className="text-sm font-semibold text-[#ececf1]">Dark theme</h2>
            <div className="flex items-center gap-4 text-xs text-[#a3a3a3]">
              <button className="hover:text-white">Import</button>
              <button className="hover:text-white">Copy theme</button>
              <div className="relative">
                <select className="appearance-none bg-white/5 border border-white/10 rounded-md pl-8 pr-8 py-1.5 text-xs outline-none text-white min-w-[120px]">
                  <option>Codex</option>
                  <option>Default</option>
                </select>
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full flex items-center justify-center text-[8px] font-bold text-black font-serif">Aa</span>
              </div>
            </div>
          </div>
          
          <SettingsRow label="Accent" control={{ type: "toggle", value: false, onChange: () => {} }}>
            <div className="w-[120px] h-7 bg-[#339CFF] rounded text-white flex items-center justify-center text-xs ml-auto font-mono">{darkAccent}</div>
          </SettingsRow>
          
          <SettingsRow label="Background" control={{ type: "toggle", value: false, onChange: () => {} }} borderBottom={false}>
            <div className="w-[120px] h-7 bg-[#181818] rounded border border-white/20 text-white flex items-center justify-center text-xs ml-auto font-mono">{darkBg}</div>
          </SettingsRow>
        </div>
      </div>

    </div>
  );
}

import type { AppSettings } from "../../../lib/bridge";
import { SettingsRow } from "../SettingsRow";

type Props = { settings: AppSettings; onChange: (next: AppSettings) => void; saving: boolean };

export function AppearanceSettings({ settings, onChange, saving }: Props) {
  const update = (patch: Partial<AppSettings["appearance"]>) => onChange({ ...settings, appearance: { ...settings.appearance, ...patch } });
  return <div className="max-w-[700px] mx-auto px-10 py-12">
    <h1 className="text-2xl font-medium text-white">Appearance</h1>
    <p className="mt-2 mb-8 text-sm text-white/50">These values update Whim immediately and persist in native settings.</p>
    <div className="bg-white/[0.02] border border-white/5 rounded-xl px-5">
      <SettingsRow label="Accent" description="Used by focus rings, active states, progress, and the agent status color." control={{ type: "custom", node: <label className="flex items-center gap-2"><input aria-label="Accent color" type="color" value={settings.appearance.accent} onChange={(event) => update({ accent: event.target.value })} className="h-8 w-10 rounded border border-white/10 bg-transparent"/><code className="text-xs text-white/60">{settings.appearance.accent}</code></label> }}/>
      <SettingsRow label="Interface font" control={{ type: "select", value: settings.appearance.uiFont, options: ["IBM Plex Sans Variable", "Geist Variable", "Segoe UI Variable"], onChange: (uiFont) => update({ uiFont }) }}/>
      <SettingsRow label="Code font" control={{ type: "select", value: settings.appearance.codeFont, options: ["JetBrains Mono Variable", "Cascadia Mono", "Consolas"], onChange: (codeFont) => update({ codeFont }) }}/>
      <SettingsRow label="Interface font size" description="Scales Whim's interface and rem-based layout." control={{ type: "custom", node: <div className="flex items-center gap-3"><input aria-label="Interface font size" type="range" min="11" max="20" value={settings.appearance.uiFontSize} onChange={(event) => update({ uiFontSize: Number(event.target.value) })} className="w-36"/><span className="w-10 text-right font-mono text-xs text-white/60">{settings.appearance.uiFontSize}px</span></div> }}/>
      <SettingsRow label="Code font size" description="Changes code, terminal, and keyboard-label text." control={{ type: "custom", node: <div className="flex items-center gap-3"><input aria-label="Code font size" type="range" min="10" max="24" value={settings.appearance.codeFontSize} onChange={(event) => update({ codeFontSize: Number(event.target.value) })} className="w-36"/><span className="w-10 text-right font-mono text-xs text-white/60">{settings.appearance.codeFontSize}px</span></div> }}/>
      <SettingsRow label="Reduced motion" description="Follow Windows, always reduce, or keep Whim's motion enabled." control={{ type: "select", value: settings.appearance.reduceMotion, options: ["system", "on", "off"], onChange: (reduceMotion) => update({ reduceMotion: reduceMotion as AppSettings["appearance"]["reduceMotion"] }) }}/>
      <SettingsRow label="Pointer cursors" description="Show a pointer over interactive controls." control={{ type: "toggle", value: settings.appearance.pointerCursors, onChange: (pointerCursors) => update({ pointerCursors }) }}/>
      <SettingsRow label="Surface contrast" description="Adjusts divider and elevated-surface separation without changing content colors." control={{ type: "custom", node: <div className="flex items-center gap-3"><input aria-label="Surface contrast" type="range" min="0" max="100" value={settings.appearance.contrast} onChange={(event) => update({ contrast: Number(event.target.value) })} className="w-36"/><span className="w-8 text-right font-mono text-xs text-white/60">{settings.appearance.contrast}</span></div> }} borderBottom={false}/>
    </div>
    <p className="mt-5 text-xs text-white/40">{saving ? "Saving appearance…" : "Applied to the current window."}</p>
  </div>;
}

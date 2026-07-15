import { Keyboard } from "lucide-react";
import { SettingsRow } from "../SettingsRow";

const shortcuts = [
  ["New task", "Ctrl N"],
  ["New Chat", "Ctrl Alt N"],
  ["Command palette", "Ctrl K"],
  ["Find a file", "Ctrl P"],
  ["Toggle bottom panel", "Ctrl J"],
  ["Open settings", "Ctrl ,"],
] as const;

export function KeyboardShortcutsSettings() {
  return <div className="mx-auto max-w-[700px] px-10 py-12"><h1 className="flex items-center gap-2 text-2xl font-medium text-white"><Keyboard size={21}/> Keyboard shortcuts</h1><p className="mt-2 mb-8 text-sm text-white/50">These shortcuts are handled by the desktop window and match the visible Whim actions.</p><div className="rounded-xl border border-white/5 bg-white/[0.02] px-5">{shortcuts.map(([label, shortcut], index) => <SettingsRow key={label} label={label} control={{ type: "custom", node: <kbd className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-white/65">{shortcut}</kbd> }} borderBottom={index !== shortcuts.length - 1}/>)}</div></div>;
}

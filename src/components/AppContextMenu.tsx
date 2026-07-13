import { useState } from "react";
import { Camera, ChevronDown, Code2, Monitor, Terminal } from "lucide-react";
import { bridge, errorMessage, type AppContextResult } from "../lib/bridge";

export function AppContextMenu({ onCapture }: { onCapture: (result: AppContextResult) => void }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const capture = async (source: AppContextResult["source"]) => { setBusy(true); try { onCapture(await bridge.captureAppContext(source)); } catch (cause) { onCapture({ source, available: false, message: errorMessage(cause) }); } finally { setBusy(false); setOpen(false); } };
  return <div className="relative">
    <button type="button" onClick={() => setOpen(!open)} disabled={busy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#a3a3a3] hover:text-white"><Monitor size={12}/> App Context <ChevronDown size={11}/></button>
    {open && <div className="absolute bottom-full mb-2 right-0 w-56 rounded-lg border border-white/10 bg-[#2b2b2b] p-1 shadow-xl z-50">
      <button onClick={() => void capture("vscode")} className="w-full flex gap-2 p-2 text-xs text-white/80 hover:bg-white/10 rounded"><Code2 size={14}/> Read from VS Code</button>
      <button onClick={() => void capture("terminal")} className="w-full flex gap-2 p-2 text-xs text-white/80 hover:bg-white/10 rounded"><Terminal size={14}/> Read from Terminal</button>
      <button onClick={() => void capture("screenshot")} className="w-full flex gap-2 p-2 text-xs text-white/80 hover:bg-white/10 rounded"><Camera size={14}/> Take Screenshot</button>
    </div>}
  </div>;
}

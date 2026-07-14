import { useEffect, useMemo, useRef, useState } from "react";
import {
  Blocks,
  Bot,
  CheckCircle2,
  Code2,
  Command,
  FileSearch,
  FolderOpen,
  Rocket,
  Search,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import type { ViewId } from "./WorkspaceRail";

type PaletteCommand = { id: string; label: string; hint: string; icon: LucideIcon; action: () => void; keywords: string };

type CommandPaletteProps = {
  open: boolean;
  projectName: string;
  onClose: () => void;
  onNavigate: (view: ViewId) => void;
  onOpenWorkspace: () => void;
};

export function CommandPalette({ open, projectName, onClose, onNavigate, onOpenWorkspace }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands: PaletteCommand[] = useMemo(() => [
    { id: "ask", label: "Ask Whim to change something", hint: "Agent", icon: Sparkles, keywords: "prompt intent agent change", action: () => { onNavigate("build"); onClose(); requestAnimationFrame(() => window.dispatchEvent(new Event("whim:focus-agent"))); } },
    { id: "file", label: "Find a file", hint: "Files", icon: FileSearch, keywords: "file symbol search", action: () => { onNavigate("build"); onClose(); requestAnimationFrame(() => window.dispatchEvent(new Event("whim:focus-files"))); } },
    { id: "workspace", label: "Open a workspace", hint: "Native", icon: FolderOpen, keywords: "folder project open", action: () => { onOpenWorkspace(); onClose(); } },
    { id: "models", label: "Connect or switch a model", hint: "Configured routes", icon: Bot, keywords: "provider model local lm studio ollama", action: () => { onNavigate("providers"); onClose(); } },
    { id: "plugins", label: "Add a plugin, MCP, or skill", hint: "Ecosystem", icon: Blocks, keywords: "plugin skill mcp install", action: () => { onNavigate("ecosystem"); onClose(); } },
    { id: "verify", label: "Run release readiness", hint: "Ship", icon: CheckCircle2, keywords: "test check browser journey", action: () => { onNavigate("ship"); onClose(); } },
    { id: "ship", label: "Prepare a private preview", hint: "Ship", icon: Rocket, keywords: "deploy preview vercel ship", action: () => { onNavigate("ship"); onClose(); } },
    { id: "auto", label: "Tune automatic everything", hint: "Autopilot", icon: WandSparkles, keywords: "automation settings personalize", action: () => { onNavigate("autopilot"); onClose(); } },
  ], [onNavigate, onClose, onOpenWorkspace]);

  const shown = commands.filter((command) => `${command.label} ${command.keywords}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => setSelectedIndex(0), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((index) => Math.min(index + 1, Math.max(0, shown.length - 1))); }
      if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((index) => Math.max(0, index - 1)); }
      if (event.key === "Enter" && shown[selectedIndex]) { event.preventDefault(); shown[selectedIndex].action(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose, selectedIndex, shown]);

  if (!open) return null;
  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search"><Search size={17} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do you want to do?" /><kbd>ESC</kbd></div>
        <div className="palette-context"><span><Sparkles size={11} /> Current workspace</span><span>{projectName}</span></div>
        <div className="palette-results">
          <small>{query ? "Matching actions" : "Suggested now"}</small>
          {shown.map((item, index) => {
            const Icon = item.icon;
            return <button className={index === selectedIndex ? "highlighted" : ""} type="button" key={item.id} onMouseEnter={() => setSelectedIndex(index)} onClick={item.action}><span className="palette-icon"><Icon size={15} /></span><span>{item.label}</span><em>{item.hint}</em></button>;
          })}
          {shown.length === 0 && <div className="palette-empty"><Code2 size={18} /><span><strong>No exact command</strong><small>Press Enter in the agent panel to describe the outcome instead.</small></span></div>}
        </div>
        <div className="palette-footer"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> run</span><span><Command size={11} /> Whim commands are reversible where possible</span></div>
      </div>
    </div>
  );
}

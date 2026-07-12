import {
  Blocks,
  Bot,
  Boxes,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Rocket,
  Settings2,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

export type ViewId = "build" | "providers" | "ecosystem" | "orchestrate" | "ship" | "autopilot";

const items: { id: ViewId; label: string; icon: LucideIcon; accent?: boolean }[] = [
  { id: "build", label: "Build", icon: LayoutDashboard },
  { id: "orchestrate", label: "Orchestrate", icon: ListChecks },
  { id: "providers", label: "Models", icon: Bot },
  { id: "ecosystem", label: "Ecosystem", icon: Blocks },
  { id: "ship", label: "Ship", icon: Rocket, accent: true },
  { id: "autopilot", label: "Autopilot", icon: WandSparkles },
];

export function WorkspaceRail({ active, onChange, changeCount = 0, onSourceControl }: { active: ViewId; onChange: (view: ViewId) => void; changeCount?: number; onSourceControl?: () => void }) {
  return (
    <nav className="workspace-rail" aria-label="Primary navigation">
      <div className="rail-main">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`rail-button ${active === item.id ? "active" : ""} ${item.accent ? "accent" : ""}`}
              type="button"
              onClick={() => onChange(item.id)}
              aria-label={item.label}
              aria-current={active === item.id ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span className="rail-tooltip">{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="rail-bottom">
        <button className="rail-button" type="button" aria-label="Source control" onClick={onSourceControl ?? (() => onChange("build"))}>
          <GitBranch size={18} />
          {changeCount > 0 && <span className="rail-badge">{changeCount > 99 ? "99+" : changeCount}</span>}
          <span className="rail-tooltip">Source control</span>
        </button>
        <button className="rail-button" type="button" aria-label="Runtimes" onClick={() => onChange("autopilot")}>
          <Boxes size={18} />
          <span className="rail-tooltip">Runtimes</span>
        </button>
        <button className="rail-button" type="button" aria-label="Settings" onClick={() => onChange("autopilot")}>
          <Settings2 size={18} />
          <span className="rail-tooltip">Settings</span>
        </button>
        <div className="user-orb"><Sparkles size={13} /></div>
      </div>
    </nav>
  );
}

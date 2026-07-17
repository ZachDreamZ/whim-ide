import {
  Blocks,
  Bot,
  Boxes,
  Clapperboard,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Orbit,
  Rocket,
  Settings2,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

export type ViewId = "build" | "scheduled" | "plugins" | "eve" | "sites" | "pullRequests" | "chat" | "browser" | "creative" | "providers" | "ecosystem" | "orchestrate" | "ship" | "autopilot" | "settings";

const items: { id: ViewId; label: string; icon: LucideIcon; accent?: boolean }[] = [
  { id: "build", label: "New chat", icon: LayoutDashboard },
  { id: "scheduled", label: "Scheduled", icon: ListChecks },
  { id: "plugins", label: "Plugins", icon: Blocks },
  { id: "eve", label: "Eve Agents", icon: Orbit, accent: true },
  { id: "sites", label: "Sites", icon: Rocket, accent: true },
  { id: "pullRequests", label: "Pull requests", icon: GitBranch },
  { id: "chat", label: "Chat", icon: MessageSquareText },
  { id: "creative", label: "Creative Studio", icon: Clapperboard, accent: true },
  { id: "providers", label: "Models & Providers", icon: Bot },
  { id: "autopilot", label: "Autopilot", icon: WandSparkles },
];

export function WorkspaceRail({ active, onChange, changeCount = 0, onSourceControl }: { active: ViewId; onChange: (view: ViewId) => void; changeCount?: number; onSourceControl?: () => void }) {
  return (
    <nav className="w-[58px] h-full bg-[#0d0f14] border-r border-white/5 flex flex-col justify-between items-center py-4 select-none shrink-0" aria-label="Primary navigation">
      {/* Top section: Primary views */}
      <div className="flex flex-col gap-3 w-full items-center">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <div key={item.id} className="relative group flex justify-center w-full">
              {/* Active neon dot indicator */}
              <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] bg-[#ff6f4c] rounded-r transition-all duration-200 ${isActive ? "opacity-100 scale-100" : "opacity-0 scale-50 group-hover:opacity-40"}`} />

              <button
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-150 cursor-pointer ${isActive ? "bg-white/5 text-[#ff6f4c]" : "text-[#8a95a5] hover:bg-white/[0.03] hover:text-[#dfe3eb]"}`}
                type="button"
                onClick={() => onChange(item.id)}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={19} strokeWidth={1.8} />
              </button>

              {/* Premium Tooltip */}
              <div className="absolute left-[64px] top-1/2 -translate-y-1/2 bg-[#151922] border border-white/5 text-[#dfe3eb] text-xs font-medium px-2.5 py-1 rounded shadow-xl opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 pointer-events-none transition-all duration-150 z-55 white-space-nowrap">
                {item.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom section: Utilities */}
      <div className="flex flex-col gap-3 w-full items-center">
        {/* Source Control */}
        <div className="relative group flex justify-center w-full">
          <button
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[#8a95a5] hover:bg-white/[0.03] hover:text-[#dfe3eb] transition-all duration-150 cursor-pointer relative"
            type="button"
            aria-label="Source control"
            onClick={onSourceControl ?? (() => onChange("build"))}
          >
            <GitBranch size={18} />
            {changeCount > 0 && (
              <span className="absolute top-1.5 right-1.5 bg-[#ff6f4c] text-[#0d0b0a] font-bold text-[9px] px-1 min-w-[14px] h-[14px] rounded-full flex items-center justify-center scale-90">
                {changeCount > 99 ? "99+" : changeCount}
              </span>
            )}
          </button>
          <div className="absolute left-[64px] top-1/2 -translate-y-1/2 bg-[#151922] border border-white/5 text-[#dfe3eb] text-xs font-medium px-2.5 py-1 rounded shadow-xl opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 pointer-events-none transition-all duration-150 z-55 white-space-nowrap">
            Source Control
          </div>
        </div>

        {/* Runtimes */}
        <div className="relative group flex justify-center w-full">
          <button
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[#8a95a5] hover:bg-white/[0.03] hover:text-[#dfe3eb] transition-all duration-150 cursor-pointer"
            type="button"
            aria-label="Runtimes"
            onClick={() => onChange("autopilot")}
          >
            <Boxes size={18} />
          </button>
          <div className="absolute left-[64px] top-1/2 -translate-y-1/2 bg-[#151922] border border-white/5 text-[#dfe3eb] text-xs font-medium px-2.5 py-1 rounded shadow-xl opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 pointer-events-none transition-all duration-150 z-55 white-space-nowrap">
            Runtimes
          </div>
        </div>

        {/* Settings */}
        <div className="relative group flex justify-center w-full">
          <button
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[#8a95a5] hover:bg-white/[0.03] hover:text-[#dfe3eb] transition-all duration-150 cursor-pointer"
            type="button"
            aria-label="Settings"
            onClick={() => onChange("settings")}
          >
            <Settings2 size={18} />
          </button>
          <div className="absolute left-[64px] top-1/2 -translate-y-1/2 bg-[#151922] border border-white/5 text-[#dfe3eb] text-xs font-medium px-2.5 py-1 rounded shadow-xl opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 pointer-events-none transition-all duration-150 z-55 white-space-nowrap">
            Settings
          </div>
        </div>

        {/* User Orb */}
        <div className="w-8 h-8 rounded-full bg-[#1e2430] border border-white/10 flex items-center justify-center text-[#ff6f4c] font-bold text-xs mt-1 shadow-inner relative group cursor-pointer hover:border-[#ff6f4c]/30 transition-all duration-150">
          <Sparkles size={12} className="animate-pulse" />
          <div className="absolute left-[64px] top-1/2 -translate-y-1/2 bg-[#151922] border border-white/5 text-[#dfe3eb] text-xs font-medium px-2.5 py-1 rounded shadow-xl opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 pointer-events-none transition-all duration-150 z-55 white-space-nowrap">
            Whim Assistant
          </div>
        </div>
      </div>
    </nav>
  );
}

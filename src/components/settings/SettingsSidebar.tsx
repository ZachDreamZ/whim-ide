import { Settings, User, Paintbrush, Mic, Sliders, Wand2, Cat, Keyboard, Plug2, Globe, Monitor, Webhook, Link2, GitBranch, LayoutGrid, Folders, Archive } from "lucide-react";

interface CategoryGroup {
  name: string;
  items: { id: string; label: string; icon: React.ReactNode }[];
}

const CATEGORIES: CategoryGroup[] = [
  {
    name: "Personal",
    items: [
      { id: "general", label: "General", icon: <Settings size={16} /> },
      { id: "profile", label: "Profile", icon: <User size={16} /> },
      { id: "appearance", label: "Appearance", icon: <Paintbrush size={16} /> },
      { id: "voice", label: "Voice", icon: <Mic size={16} /> },
      { id: "configuration", label: "Configuration", icon: <Sliders size={16} /> },
      { id: "personalization", label: "Personalization", icon: <Wand2 size={16} /> },
      { id: "pets", label: "Pets", icon: <Cat size={16} /> },
      { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard size={16} /> },
    ]
  },
  {
    name: "Integrations",
    items: [
      { id: "plugins", label: "Plugins", icon: <Plug2 size={16} /> },
      { id: "browser", label: "Browser", icon: <Globe size={16} /> },
      { id: "computer", label: "Computer use", icon: <Monitor size={16} /> },
    ]
  },
  {
    name: "Coding",
    items: [
      { id: "hooks", label: "Hooks", icon: <Webhook size={16} /> },
      { id: "connections", label: "Connections", icon: <Link2 size={16} /> },
      { id: "git", label: "Git", icon: <GitBranch size={16} /> },
      { id: "environments", label: "Environments", icon: <LayoutGrid size={16} /> },
      { id: "worktrees", label: "Worktrees", icon: <Folders size={16} /> },
    ]
  },
  {
    name: "Archived",
    items: [
      { id: "archived-tasks", label: "Archived tasks", icon: <Archive size={16} /> },
    ]
  }
];

export interface SettingsSidebarProps {
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}

export function SettingsSidebar({ activeCategory, onCategoryChange }: SettingsSidebarProps) {
  return (
    <div className="flex-1 overflow-y-auto pb-6">
      {CATEGORIES.map((group) => (
        <div key={group.name} className="mb-4">
          <div className="px-4 py-2 text-xs font-medium text-[#a3a3a3] uppercase tracking-wider">
            {group.name}
          </div>
          <div className="flex flex-col px-2">
            {group.items.map((item) => (
              <button
                key={item.id}
                onClick={() => onCategoryChange(item.id)}
                className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  activeCategory === item.id 
                    ? "bg-[#2f2f2f] text-white" 
                    : "text-[#ececf1] hover:bg-white/5"
                }`}
              >
                <span className="text-[#a3a3a3]">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

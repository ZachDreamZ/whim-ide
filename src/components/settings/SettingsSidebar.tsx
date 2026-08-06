import { Blocks, Cable, Download, FileCog, Keyboard, Settings, Paintbrush, Mic, Monitor, MessageSquareText, SlidersHorizontal } from "lucide-react";

interface CategoryGroup {
  name: string;
  items: { id: string; label: string; icon: React.ReactNode }[];
}

const CATEGORIES: CategoryGroup[] = [
  {
    name: "Personal",
    items: [
      { id: "general", label: "General", icon: <Settings size={16} /> },
      { id: "personalization", label: "Personalization", icon: <SlidersHorizontal size={16} /> },
      { id: "chat", label: "Chat", icon: <MessageSquareText size={16} /> },
      { id: "appearance", label: "Appearance", icon: <Paintbrush size={16} /> },
      { id: "voice", label: "Voice", icon: <Mic size={16} /> },
      { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard size={16} /> },
    ]
  },
  {
    name: "Application",
    items: [
      { id: "updates", label: "Updates", icon: <Download size={16} /> },
    ]
  },
  {
    name: "Integrations",
    items: [
      { id: "configuration", label: "Configuration", icon: <FileCog size={16} /> },
      { id: "plugins-link", label: "Plugins", icon: <Blocks size={16} /> },
      { id: "connections-link", label: "Connections", icon: <Cable size={16} /> },
      { id: "computer", label: "Computer use", icon: <Monitor size={16} /> },
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
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {group.name}
          </div>
          <div className="flex flex-col px-2">
            {group.items.map((item) => (
              <button
                key={item.id}
                onClick={() => onCategoryChange(item.id)}
                className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  activeCategory === item.id 
                    ? "bg-accent text-foreground" 
                    : "text-foreground/90 hover:bg-accent"
                }`}
              >
                <span className="text-muted-foreground">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

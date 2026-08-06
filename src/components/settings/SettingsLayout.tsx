import { ReactNode } from "react";
import { SettingsSidebar } from "./SettingsSidebar";
import { ArrowLeft } from "lucide-react";

export interface SettingsLayoutProps {
  onClose: () => void;
  children: ReactNode;
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}

export function SettingsLayout({ onClose, children, activeCategory, onCategoryChange }: SettingsLayoutProps) {
  return (
    <div className="settings-overlay absolute inset-0 z-50 flex bg-background text-foreground">
      <div className="settings-sidebar-wrapper w-[260px] flex flex-col border-r border-border bg-card">
        <div className="settings-header flex items-center h-14 px-4 border-b border-border">
          <button 
            onClick={onClose}
            className="flex items-center text-sm font-medium hover:bg-accent px-2 py-1.5 rounded-lg transition-colors gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} /> Back to app
          </button>
        </div>
        <div className="px-4 py-4 text-xs leading-relaxed text-foreground/40">Native configuration<br/><span className="text-foreground/25">No placeholder sections</span></div>
        <SettingsSidebar activeCategory={activeCategory} onCategoryChange={onCategoryChange} />
      </div>
      <div className="settings-content flex-1 overflow-y-auto bg-background">
        {children}
      </div>
    </div>
  );
}

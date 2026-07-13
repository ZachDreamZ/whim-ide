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
    <div className="settings-overlay absolute inset-0 z-50 flex bg-[#171717] text-[#ececf1]">
      <div className="settings-sidebar-wrapper w-[260px] flex flex-col border-r border-white/10 bg-[#171717]">
        <div className="settings-header flex items-center h-14 px-4 border-b border-white/5">
          <button 
            onClick={onClose}
            className="flex items-center text-sm font-medium hover:bg-white/5 px-2 py-1.5 rounded-lg transition-colors gap-2 text-[#a3a3a3] hover:text-white"
          >
            <ArrowLeft size={16} /> Back to app
          </button>
        </div>
        <div className="px-4 py-4 text-xs leading-relaxed text-white/40">Native configuration<br/><span className="text-white/25">No placeholder sections</span></div>
        <SettingsSidebar activeCategory={activeCategory} onCategoryChange={onCategoryChange} />
      </div>
      <div className="settings-content flex-1 overflow-y-auto bg-[#171717]">
        {children}
      </div>
    </div>
  );
}

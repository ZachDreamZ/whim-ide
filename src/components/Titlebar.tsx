import {
  ChevronDown,
  Cloud,
  Command,
  Minus,
  PanelTopClose,
  Square,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrandMark } from "./BrandMark";

type TitlebarProps = {
  projectName: string;
  model: string;
  native: boolean;
  onCommand: () => void;
  onProviderClick: () => void;
  onProjectClick: () => void;
};

export function Titlebar({ projectName, model, native, onCommand, onProviderClick, onProjectClick }: TitlebarProps) {
  const windowAction = async (action: "minimize" | "maximize" | "close") => {
    if (!native) return;
    try {
      const current = getCurrentWindow();
      if (action === "minimize") await current.minimize();
      if (action === "maximize") await current.toggleMaximize();
      if (action === "close") await current.close();
    } catch (error) {
      console.error(`Could not ${action} Whim window`, error);
    }
  };

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <BrandMark />
        <span className="titlebar-divider" />
        <button className="project-switcher" type="button" onClick={onProjectClick} title="Open another workspace">
          <span className="project-dot" />
          {projectName}
          <ChevronDown size={13} />
        </button>
      </div>
      <div className="titlebar-drag" data-tauri-drag-region>
        <button className="command-trigger" type="button" onClick={onCommand}>
          <Command size={14} />
          <span>Jump to anything</span>
          <kbd>Ctrl K</kbd>
        </button>
      </div>
      <div className="titlebar-right">
        <button className="model-pill" type="button" onClick={onProviderClick} title="Choose model and provider">
          <Cloud size={13} />
          <span>{model}</span>
          <ChevronDown size={12} />
        </button>
        <div className="window-controls" aria-label="Window controls">
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => void windowAction("minimize")} aria-label="Minimize" title="Minimize"><Minus size={15} /></button>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => void windowAction("maximize")} aria-label="Maximize" title="Maximize"><Square size={12} /></button>
          <button className="window-close" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => void windowAction("close")} aria-label="Close" title="Close"><X size={15} /></button>
        </div>
        {!native && <PanelTopClose className="browser-indicator" size={13} aria-label="Browser preview" />}
      </div>
    </header>
  );
}

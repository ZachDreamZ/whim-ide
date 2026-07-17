import { useEffect, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen, MoreHorizontal, Folder, Copy, Plus } from "lucide-react";
import { Button } from "./ui/button";

type ConversationHeaderProps = {
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  title?: string;
  projectName?: string;
  onNewChat?: () => void;
  onCopy?: () => void;
};

export function ConversationHeader({
  inspectorOpen,
  onToggleInspector,
  title = "New chat",
  projectName,
  onNewChat,
  onCopy,
}: ConversationHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const handleCopy = () => {
    setMenuOpen(false);
    const content = document.querySelector(".agent-conversation-content")?.textContent ?? "";
    navigator.clipboard?.writeText(content).catch(() => {});
    onCopy?.();
  };

  return (
    <header className="conversation-header">
      <div className="flex items-center gap-2 min-w-0">
        {projectName && (
          <span className="conversation-header-project" title={projectName}>
            <Folder size={14} />
          </span>
        )}
        <span className="text-sm font-medium truncate">{title}</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="relative" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={16} />
          </Button>
          {menuOpen && (
            <div className="conversation-header-menu" role="menu">
              <button type="button" className="conversation-header-menu-item" role="menuitem" onClick={handleCopy}>
                <Copy size={14} />
                <span>Copy conversation</span>
              </button>
              {onNewChat && (
                <button
                  type="button"
                  className="conversation-header-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onNewChat();
                  }}
                >
                  <Plus size={14} />
                  <span>New chat</span>
                </button>
              )}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={inspectorOpen ? "Close inspector" : "Open inspector"}
          onClick={onToggleInspector}
        >
          {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </Button>
      </div>
    </header>
  );
}

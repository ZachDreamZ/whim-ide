import { PanelRightClose, PanelRightOpen, MoreHorizontal } from "lucide-react";
import { Button } from "./ui/button";

type ConversationHeaderProps = {
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  title?: string;
};

export function ConversationHeader({
  inspectorOpen,
  onToggleInspector,
  title = "New chat",
}: ConversationHeaderProps) {
  return (
    <header className="conversation-header">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">{title}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="More options">
          <MoreHorizontal size={16} />
        </Button>
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

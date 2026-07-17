import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { Button } from "./ui/button";

type MessageComposerProps = {
  onSend: (content: string) => void;
  onStop?: () => void;
  isRunning?: boolean;
  placeholder?: string;
};

export function MessageComposer({
  onSend,
  onStop,
  isRunning = false,
  placeholder = "What do you want to build?",
}: MessageComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isRunning && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isRunning]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isRunning) return;
    onSend(trimmed);
    setValue("");
  }, [value, isRunning, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="message-composer">
      <div className="message-composer-inner">
        <button
          type="button"
          className="composer-attach-button"
          aria-label="Attach files"
        >
          <Paperclip size={16} />
        </button>
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            // Auto-resize
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isRunning}
        />
        {isRunning ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onStop}
            aria-label="Stop"
            className="composer-stop-button"
          >
            <Square size={16} />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon-sm"
            onClick={handleSend}
            disabled={!value.trim()}
            aria-label="Send"
            className="composer-send-button"
          >
            <ArrowUp size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}

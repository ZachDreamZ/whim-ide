import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react";
import { cn } from "../utils/cn";

export type SendButtonProps = {
  state: "idle" | "typing" | "streaming";
  onClick: () => void;
  disabled?: boolean;
};

export function SendButton({ state, onClick, disabled = false }: SendButtonProps) {
  const isStreaming = state === "streaming";
  const isTyping = state === "typing";

  if (isStreaming) {
    return (
      <button type="button" onClick={onClick} aria-label="Stop generating" className="size-7 rounded-full bg-foreground flex items-center justify-center cursor-pointer">
        <IconPlayerStopFilled className="size-4 text-background" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !isTyping}
      aria-label="Send message"
      className={cn(
        "size-7 rounded-full flex items-center justify-center",
        isTyping
          ? "bg-an-send-button-bg cursor-pointer"
          : "bg-muted cursor-default",
      )}
    >
      <IconArrowUp
        className={cn(
          "size-4",
          isTyping
            ? "text-an-send-button-color"
            : "text-neutral-400 dark:text-neutral-600",
        )}
      />
    </button>
  );
}

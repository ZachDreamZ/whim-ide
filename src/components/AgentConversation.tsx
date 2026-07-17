import { useRef, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { useSmartAutoScroll } from "../hooks/useSmartAutoScroll";
import { TimelineEvent } from "./TimelineEvent";
import { MessageComposer } from "./MessageComposer";

type AgentConversationProps = {
  messages: UIMessage[];
  isRunning?: boolean;
  onSend: (content: string) => void;
  onStop?: () => void;
  emptyState?: ReactNode;
};

function isErrorPart(part: Record<string, unknown>): boolean {
  return part.type === "error";
}

function isToolPart(part: Record<string, unknown>): boolean {
  return part.type === "tool-invocation";
}

function isTextPart(part: Record<string, unknown>): boolean {
  return part.type === "text";
}

export function AgentConversation({
  messages,
  isRunning = false,
  onSend,
  onStop,
  emptyState,
}: AgentConversationProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { showJumpButton, scrollToBottom } = useSmartAutoScroll(scrollContainerRef);

  return (
    <div className="agent-conversation">
      <div ref={scrollContainerRef} className="agent-conversation-scroll">
        <div className="agent-conversation-content">
          {messages.length === 0 && emptyState ? (
            emptyState
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`conversation-message conversation-message--${msg.role}`}
              >
                {msg.parts?.map((part, i) => {
                  const p = part as Record<string, unknown>;
                  if (isTextPart(p)) {
                    return (
                      <p key={i} className="message-text">
                        {String(p.text ?? "")}
                      </p>
                    );
                  }
                  if (isToolPart(p)) {
                    return (
                      <TimelineEvent
                        key={String(p.toolCallId ?? i)}
                        event={{
                          id: String(p.toolCallId ?? i),
                          type: "tool_invocation",
                          status: isRunning ? "running" : "succeeded",
                          label: `Using ${String(p.toolName ?? "tool")}`,
                          detail: JSON.stringify(p.args, null, 2),
                        }}
                      />
                    );
                  }
                  if (isErrorPart(p)) {
                    return (
                      <TimelineEvent
                        key={i}
                        event={{
                          id: String(i),
                          type: "error",
                          status: "failed",
                          label: String(p.title ?? "Error"),
                          detail: String(p.message ?? ""),
                        }}
                      />
                    );
                  }
                  return null;
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {showJumpButton && (
        <button
          type="button"
          className="jump-to-latest-button"
          onClick={scrollToBottom}
        >
          Jump to latest ↓
        </button>
      )}

      <MessageComposer
        onSend={onSend}
        onStop={onStop}
        isRunning={isRunning}
      />
    </div>
  );
}

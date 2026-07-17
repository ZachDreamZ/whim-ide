import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { bridge } from "../lib/bridge";
import { AgentConversation } from "./AgentConversation";
import { EmptyChatState } from "./EmptyChatState";

type AgentChatViewProps = {
  workspace: string | null;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  onRunComplete?: () => void;
  onActivityChange?: (running: boolean) => void;
};

interface NativeEvent {
  type?: string;
  id?: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  summary?: string;
  content?: string;
  text?: string;
  message?: string;
  status?: string;
  [key: string]: unknown;
}

function parseAgentEvent(event: NativeEvent): UIMessage["parts"][0] | null {
  if (!event) return null;

  if (event.type === "tool-execution" || event.type === "tool-start") {
    return {
      type: "tool-invocation" as const,
      toolCallId: event.id ?? crypto.randomUUID(),
      toolName: event.tool ?? "tool",
      state: event.type === "tool-start" ? ("call" as const) : ("result" as const),
      args: event.input ?? {},
      result: event.output ?? event.summary ?? "",
    } as unknown as UIMessage["parts"][0];
  }

  if (event.type === "text" || event.type === "response" || event.type === "summary" || event.type === "completion") {
    const text = event.content ?? event.text ?? "";
    if (!text) return null;
    return {
      type: "text" as const,
      text,
      state: "done" as const,
    } as UIMessage["parts"][0];
  }

  if (event.type === "error") {
    return {
      type: "text" as const,
      text: `Error: ${event.message ?? event.content ?? "Unknown error"}`,
    } as UIMessage["parts"][0];
  }

  return null;
}

export function AgentChatView({
  workspace,
  provider,
  apiKey,
  baseUrl,
  model,
  onRunComplete,
  onActivityChange,
}: AgentChatViewProps) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (messages.length === 0) {
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event("whim:focus-agent"));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [messages.length]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || isRunning) return;
      setIsRunning(true);
      onActivityChange?.(true);

      const operationId = crypto.randomUUID();

      // Create user message
      const userMsg = {
        id: crypto.randomUUID(),
        role: "user" as const,
        parts: [{ type: "text" as const, text: content }],
      } as unknown as UIMessage;

      // Create initial assistant message
      const assistantMsg = {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        parts: [],
      } as unknown as UIMessage;

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const collectedParts: UIMessage["parts"][0][] = [];

      try {
        const result = await bridge.runAgent({
          workspace: workspace ?? undefined,
          prompt: content,
          model: model ?? "auto",
          provider,
          apiKey,
          baseUrl,
          operationId,
          sessionId: sessionIdRef.current,
          autoContinue: true,
          onEvent: (event) => {
            const part = parseAgentEvent(event as NativeEvent);
            if (part) {
              collectedParts.push(part);
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                  updated[lastIdx] = {
                    id: updated[lastIdx].id,
                    role: "assistant",
                    parts: [...collectedParts],
                  } as unknown as UIMessage;
                }
                return updated;
              });
            }
          },
        });

        if (result.sessionId) {
          sessionIdRef.current = result.sessionId;
        }

        onRunComplete?.();
      } catch (error) {
        const errorText = error instanceof Error ? error.message : "Request failed";
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
            updated[lastIdx] = {
              id: updated[lastIdx].id,
              role: "assistant",
              parts: [
                ...collectedParts,
                { type: "text", text: `Error: ${errorText}` } as UIMessage["parts"][0],
              ],
            } as unknown as UIMessage;
          }
          return updated;
        });
      } finally {
        setIsRunning(false);
        onActivityChange?.(false);
      }
    },
    [workspace, provider, apiKey, baseUrl, model, isRunning, onRunComplete, onActivityChange]
  );

  const handleStop = useCallback(() => {
    const activeOp = operationIdRef.current;
    if (activeOp) {
      bridge.cancelOperation(activeOp).catch(() => {});
    }
    setIsRunning(false);
    onActivityChange?.(false);
  }, [onActivityChange]);

  const operationIdRef = useRef<string | undefined>(undefined);
  const wrappedSend = useCallback(
    (content: string) => {
      operationIdRef.current = crypto.randomUUID();
      void handleSend(content);
    },
    [handleSend]
  );

  return (
    <AgentConversation
      messages={messages}
      isRunning={isRunning}
      onSend={wrappedSend}
      onStop={handleStop}
      emptyState={<EmptyChatState onSend={wrappedSend} />}
    />
  );
}

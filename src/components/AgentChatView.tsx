import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { bridge } from "../lib/bridge";
import type { ChatThread } from "../lib/bridge";
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
  resetKey?: number;
  initialThreadId?: string | null;
  onOpenFile?: (path: string) => void;
  projectName?: string;
  micSupported?: boolean;
  onOpenProviders?: () => void;
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

function generateTitle(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  // Use the first meaningful sentence
  const sentence = cleaned.match(/^(.+?[.!?])\s/)?.[1] ?? cleaned;
  return sentence.length > 72 ? sentence.slice(0, 69) + "..." : sentence;
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

  if (
    event.type === "text" ||
    event.type === "response" ||
    event.type === "summary" ||
    event.type === "completion"
  ) {
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

function collectText(parts: UIMessage["parts"][0][]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");
}

export function AgentChatView({
  workspace,
  provider,
  apiKey,
  baseUrl,
  model,
  onRunComplete,
  onActivityChange,
  resetKey,
  initialThreadId,
  onOpenFile,
  projectName,
  micSupported = false,
  onOpenProviders,
}: AgentChatViewProps) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationTitle, setConversationTitle] = useState("New chat");
  const sessionIdRef = useRef<string | undefined>(undefined);
  const threadIdRef = useRef<string | undefined>(undefined);
  const messageHistoryRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  // Load existing thread if initialThreadId provided
  useEffect(() => {
    if (!initialThreadId) return;
    setIsLoading(true);
    bridge
      .getChatThread(initialThreadId)
      .then((thread) => {
        threadIdRef.current = thread.id;
        setConversationTitle(thread.title);
        // Convert thread messages to UIMessage format
        const loaded: UIMessage[] = thread.messages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: "text" as const, text: m.content }],
        })) as unknown as UIMessage[];
        setMessages(loaded);
        messageHistoryRef.current = thread.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
      })
      .catch(() => {
        // Thread not found, start fresh
      })
      .finally(() => setIsLoading(false));
  }, [initialThreadId]);

  // Reset conversation when resetKey changes
  useEffect(() => {
    setMessages([]);
    setConversationTitle("New chat");
    sessionIdRef.current = undefined;
    threadIdRef.current = undefined;
    messageHistoryRef.current = [];
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("whim:focus-agent"));
    }, 100);
    return () => clearTimeout(timer);
  }, [resetKey]);

  // Persist conversation accumulating ALL messages
  const persistThread = useCallback(
    async (userContent: string, newParts: UIMessage["parts"][0][]) => {
      try {
        const threadId = threadIdRef.current ?? crypto.randomUUID();
        threadIdRef.current = threadId;

        const text = collectText(newParts);
        const title =
          messages.length === 0
            ? generateTitle(userContent)
            : conversationTitle;

        // Accumulate all messages from history
        const allMessages: ChatThread["messages"] = [
          ...messageHistoryRef.current.map((m) => ({
            id: crypto.randomUUID(),
            role: m.role,
            content: m.content,
            createdAtMs: Date.now(),
          })),
          {
            id: crypto.randomUUID(),
            role: "user" as const,
            content: userContent,
            createdAtMs: Date.now(),
          },
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: text || "(no text response)",
            createdAtMs: Date.now(),
          },
        ];

        const thread: ChatThread = {
          id: threadId,
          title,
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
          model: model ?? null,
          messages: allMessages,
        };

        await bridge.saveChatThread(thread);
        setConversationTitle(title);

        // Update accumulated history
        messageHistoryRef.current = [
          ...messageHistoryRef.current,
          { role: "user", content: userContent },
          { role: "assistant", content: text || "(no text response)" },
        ];

        window.dispatchEvent(new Event("whim:history-changed"));
      } catch {
        // Persistence is best-effort
      }
    },
    [messages.length, conversationTitle, model]
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || isRunning) return;
      setIsRunning(true);
      onActivityChange?.(true);

      const operationId = crypto.randomUUID();

      const userMsg = {
        id: crypto.randomUUID(),
        role: "user" as const,
        parts: [{ type: "text" as const, text: content }],
      } as unknown as UIMessage;

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
          sessionId: sessionIdRef.current ?? threadIdRef.current,
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

        // Persist all accumulated messages
        void persistThread(content, collectedParts);

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
    [
      workspace,
      provider,
      apiKey,
      baseUrl,
      model,
      isRunning,
      onRunComplete,
      onActivityChange,
      persistThread,
    ]
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

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading conversation...
      </div>
    );
  }

  return (
    <AgentConversation
      messages={messages}
      isRunning={isRunning}
      onSend={wrappedSend}
      onStop={handleStop}
      emptyState={<EmptyChatState onSend={wrappedSend} />}
      onOpenFile={onOpenFile}
      projectName={projectName}
      modelLabel={model}
      micSupported={micSupported}
      provider={provider}
      apiKey={apiKey}
      baseUrl={baseUrl}
      onOpenProviders={onOpenProviders}
    />
  );
}

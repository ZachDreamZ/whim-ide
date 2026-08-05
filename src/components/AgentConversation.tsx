import { lazy, useRef, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { useSmartAutoScroll } from "../hooks/useSmartAutoScroll";
import { TimelineEvent } from "./TimelineEvent";
import { MessageComposer } from "./MessageComposer";
import { FileChangeCard, type FileChange } from "./FileChangeCard";

const Markdown = lazy(() =>
  import("./agent-elements/markdown").then((m) => ({ default: m.Markdown }))
);

type AgentConversationProps = {
  messages: UIMessage[];
  isRunning?: boolean;
  onSend: (content: string) => void;
  onStop?: () => void;
  emptyState?: ReactNode;
  onOpenFile?: (path: string) => void;
  projectName?: string;
  modelLabel?: string;
  micSupported?: boolean;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  onOpenProviders?: () => void;
  showRetry?: boolean;
  onRetry?: () => void;
  onAttach?: () => void;
  attachments?: readonly { id: string; name: string; size?: number }[];
  onRemoveAttachment?: (id: string) => void;
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

const FILE_EDIT_TOOLS = new Set([
  "edit_file", "write_file", "create_file", "write",
  "edit", "patch", "apply_diff", "file_edit",
]);

function isFileEditTool(toolName: string): boolean {
  return FILE_EDIT_TOOLS.has(toolName) || toolName.includes("file");
}

function isDelegationPart(part: Record<string, unknown>): boolean {
  return part.type === "delegation";
}

const MAX_TOOL_DETAIL_LENGTH = 8_000;

/** Keep tool evidence useful for review without allowing one command output to
 * dominate the chat surface. Native events remain the source of detail. */
export function formatToolDetail(part: Record<string, unknown>): string {
  const evidence: Record<string, unknown> = { input: part.args ?? {} };
  if (part.result !== undefined && part.result !== "") evidence.output = part.result;
  if (part.errorText) evidence.error = part.errorText;
  let detail: string;
  try {
    detail = JSON.stringify(evidence, null, 2);
  } catch {
    detail = String(part.errorText ?? "Tool details could not be displayed.");
  }
  return detail.length > MAX_TOOL_DETAIL_LENGTH
    ? `${detail.slice(0, MAX_TOOL_DETAIL_LENGTH)}\n… output truncated for this review surface`
    : detail;
}

export function AgentConversation({
  messages,
  isRunning = false,
  onSend,
  onStop,
  emptyState,
  onOpenFile,
  projectName,
  modelLabel,
  micSupported = false,
  provider,
  apiKey,
  baseUrl,
  onOpenProviders,
  showRetry = false,
  onRetry,
  onAttach,
  attachments,
  onRemoveAttachment,
}: AgentConversationProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { showJumpButton, scrollToBottom } = useSmartAutoScroll(scrollContainerRef);

  const isEmpty = messages.length === 0;

  return (
    <div className="agent-conversation">
      {isEmpty && emptyState ? (
        <>
          {emptyState}
        </>
      ) : (
        <>
          <div ref={scrollContainerRef} className="agent-conversation-scroll">
            <div className="agent-conversation-content">
                  {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`conversation-message conversation-message--${msg.role}`}
                >
                  {msg.parts?.map((part, i) => {
                    const p = part as Record<string, unknown>;
                    if (isTextPart(p)) {
                      return (
                        <div key={i} className="message-text">
                          <Markdown content={String(p.text ?? "")} />
                        </div>
                      );
                    }
                    if (isToolPart(p)) {
                      return (
                        <TimelineEvent
                          key={String(p.toolCallId ?? i)}
                          event={{
                            id: String(p.toolCallId ?? i),
                            type: "tool_invocation",
                            status: p.errorText ? "failed" : isRunning ? "running" : "succeeded",
                            label: p.errorText ? `${String(p.toolName ?? "Tool")} failed` : `Using ${String(p.toolName ?? "tool")}`,
                            detail: formatToolDetail(p),
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
                    if (isDelegationPart(p)) {
                      return (
                        <TimelineEvent
                          key={String(p.id ?? i)}
                          event={{
                            id: String(p.id ?? i),
                            type: "delegation",
                            status: isRunning ? "running" : "succeeded",
                            label: `Delegated to ${String(p.name ?? "agent")} agent`,
                            detail: String(p.task ?? ""),
                          }}
                        />
                      );
                    }
                    return null;
                  })}
                  {msg.role === "assistant" && msg.parts && (() => {
                    const fileEdits = msg.parts
                      .map((p) => p as Record<string, unknown>)
                      .filter(
                        (p) =>
                          p.type === "tool-invocation" &&
                          isFileEditTool(String(p.toolName ?? ""))
                      );
                    if (fileEdits.length === 0) return null;
                    const files: FileChange[] = fileEdits.map((p) => ({
                      path: String((p.args as Record<string, unknown>)?.path ?? p.toolName ?? "unknown"),
                      additions: Number((p.args as Record<string, unknown>)?.additions ?? 0) || 1,
                      deletions: Number((p.args as Record<string, unknown>)?.deletions ?? 0) || 0,
                    }));
                    return (
                      <FileChangeCard
                        files={files}
                        totalAdditions={files.reduce((s, f) => s + f.additions, 0)}
                        totalDeletions={files.reduce((s, f) => s + f.deletions, 0)}
                        onOpenFile={onOpenFile}
                        onReview={onOpenFile ? () => onOpenFile(files[0].path) : undefined}
                      />
                    );
                  })()}
                </div>
              ))}
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
            projectName={projectName}
            modelLabel={modelLabel}
            micSupported={micSupported}
            provider={provider}
            apiKey={apiKey}
            baseUrl={baseUrl}
            onOpenProviders={onOpenProviders}
            showRetry={showRetry}
            onRetry={onRetry}
            onAttach={onAttach}
            attachments={attachments}
            onRemoveAttachment={onRemoveAttachment}
          />
        </>
      )}
    </div>
  );
}

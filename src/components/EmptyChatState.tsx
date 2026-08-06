import { Sparkles, Code2, Blocks, Wand2, FolderOpen, GitBranch, ShieldCheck } from "lucide-react";
import { MessageComposer } from "./MessageComposer";

type EmptyChatStateProps = {
  onSend: (content: string) => void;
  onOpenWorkspace?: () => void;
  workspaceInfo?: { path: string; name: string; gitRepository: boolean } | null;
  branch?: string | null;
  modelLabel?: string;
  micSupported?: boolean;
  enterToSend?: boolean;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  onOpenProviders?: () => void;
  showRetry?: boolean;
  onRetry?: () => void;
  isRunning?: boolean;
  onStop?: () => void;
  onAttach?: () => void;
  attachments?: readonly { id: string; name: string; size?: number }[];
  onRemoveAttachment?: (id: string) => void;
};

const suggestions = [
  {
    icon: Code2,
    title: "Understand this codebase",
    detail: "Map the architecture, key flows, and the safest next improvement.",
    text: "Analyze the current project structure and suggest improvements.",
  },
  {
    icon: Blocks,
    title: "Build a feature",
    detail: "Turn an outcome into a scoped implementation and verification plan.",
    text: "Build a new feature. First inspect the relevant code, then implement the smallest complete solution and verify it.",
  },
  {
    icon: Wand2,
    title: "Fix a failure",
    detail: "Trace a failing check to its cause and make an evidence-led repair.",
    text: "Fix the current TypeScript, test, or build failures. Use the failing evidence, make a focused change, and rerun the relevant check.",
  },
  {
    icon: Sparkles,
    title: "Run the gauntlet",
    detail: "Inspect Git state and run relevant checks. Report only actionable evidence.",
    text: "Run the project gauntlet: inspect Git state, run relevant checks, and report evidence-backed failures.",
  },
];

export function EmptyChatState({
  onSend,
  onOpenWorkspace,
  workspaceInfo,
  branch,
  modelLabel,
  micSupported = false,
  enterToSend = true,
  provider,
  apiKey,
  baseUrl,
  onOpenProviders,
  showRetry = false,
  onRetry,
  isRunning = false,
  onStop,
  onAttach,
  attachments,
  onRemoveAttachment,
}: EmptyChatStateProps) {
  const projectName = workspaceInfo?.name ?? null;
  const hasGitRepo = workspaceInfo?.gitRepository ?? false;

  return (
    <div className="empty-chat-state">
      <div className="empty-chat-welcome">
        <span className="empty-chat-eyebrow"><Sparkles size={12} /> T3 Code mode</span>
        <h2 className="empty-chat-title">What are we shipping?</h2>
        <p className="empty-chat-subtitle">
          Ask for a feature, fix, or review. Whim plans, edits, verifies, and keeps every action tied to durable evidence.
        </p>
      </div>

      <div className="empty-chat-suggestions" aria-label="Suggested missions">
        {suggestions.map(({ icon: Icon, title, detail, text }) => (
          <button
            key={title}
            type="button"
            className="empty-chat-suggestion-card"
            onClick={() => onSend(text)}
          >
            <Icon size={16} className="empty-chat-suggestion-icon" />
            <span className="empty-chat-suggestion-copy">
              <strong>{title}</strong>
              <span>{detail}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="empty-chat-composer-wrap">
        <MessageComposer
          onSend={onSend}
          onStop={onStop}
          isRunning={isRunning}
          placeholder="What do you want to build?"
          enterToSend={enterToSend}
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
      </div>

      <div className="empty-chat-guardrail">
        <ShieldCheck size={13} />
        <span>Durable task record · evidence before completion · consequential actions stay gated</span>
      </div>

      {projectName && (
        <div className="empty-chat-project-context">
          <FolderOpen size={13} />
          <span className="empty-chat-project-name">{projectName}</span>
          {hasGitRepo && branch && (
            <>
              <span className="empty-chat-project-separator">·</span>
              <GitBranch size={12} />
              <span className="empty-chat-project-branch">{branch}</span>
            </>
          )}
          {hasGitRepo && !branch && (
            <>
              <span className="empty-chat-project-separator">·</span>
              <span className="empty-chat-project-status">Git connected</span>
            </>
          )}
          {!hasGitRepo && (
            <button type="button" className="empty-chat-connect-repo" onClick={onOpenWorkspace}>
              Connect repository
            </button>
          )}
        </div>
      )}
    </div>
  );
}

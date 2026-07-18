import { Sparkles, Code2, Blocks, Wand2, FolderOpen, GitBranch } from "lucide-react";
import { MessageComposer } from "./MessageComposer";

type EmptyChatStateProps = {
  onSend: (content: string) => void;
  onOpenWorkspace?: () => void;
  workspaceInfo?: { path: string; name: string; gitRepository: boolean } | null;
  branch?: string | null;
  modelLabel?: string;
  micSupported?: boolean;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  onOpenProviders?: () => void;
  showRetry?: boolean;
  onRetry?: () => void;
  isRunning?: boolean;
  onStop?: () => void;
};

const suggestions = [
  { icon: Code2, text: "Analyze the current project structure and suggest improvements" },
  { icon: Blocks, text: "Add a new feature to handle user authentication" },
  { icon: Wand2, text: "Fix TypeScript compilation errors in the codebase" },
  { icon: Sparkles, text: "Write tests for the main components" },
];

export function EmptyChatState({
  onSend,
  onOpenWorkspace,
  workspaceInfo,
  branch,
  modelLabel,
  micSupported = false,
  provider,
  apiKey,
  baseUrl,
  onOpenProviders,
  showRetry = false,
  onRetry,
  isRunning = false,
  onStop,
}: EmptyChatStateProps) {
  const projectName = workspaceInfo?.name ?? null;
  const hasGitRepo = workspaceInfo?.gitRepository ?? false;

  return (
    <div className="empty-chat-state">
      <div className="empty-chat-welcome">
        <h2 className="empty-chat-title">What do you want to build?</h2>
        <p className="empty-chat-subtitle">
          Describe your task and Whim will inspect your project,
          make changes, and verify the result.
        </p>
      </div>

      <div className="empty-chat-suggestions">
        {suggestions.map(({ icon: Icon, text }) => (
          <button
            key={text}
            type="button"
            className="empty-chat-suggestion-card"
            onClick={() => onSend(text)}
          >
            <Icon size={15} className="empty-chat-suggestion-icon" />
            <span className="empty-chat-suggestion-text">{text}</span>
          </button>
        ))}
      </div>

      <div className="empty-chat-composer-wrap">
        <MessageComposer
          onSend={onSend}
          onStop={onStop}
          isRunning={isRunning}
          placeholder="What do you want to build?"
          modelLabel={modelLabel}
          micSupported={micSupported}
          provider={provider}
          apiKey={apiKey}
          baseUrl={baseUrl}
          onOpenProviders={onOpenProviders}
          showRetry={showRetry}
          onRetry={onRetry}
        />
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

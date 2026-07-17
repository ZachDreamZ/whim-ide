import { useState, type ReactNode } from "react";
import { ProjectSidebar, type ProjectSidebarProps } from "./ProjectSidebar";
import { ConversationHeader } from "./ConversationHeader";
import { ContextInspector } from "./ContextInspector";

type AppShellProps = {
  children: ReactNode;
  title?: string;
  sidebarProps: ProjectSidebarProps;
  branch?: string | null;
  changesCount?: number;
  projectName?: string;
  onNewChat?: () => void;
};

export function AppShell({ children, title, sidebarProps, branch, changesCount, projectName, onNewChat }: AppShellProps) {
  const [inspectorOpen, setInspectorOpen] = useState(false);

  return (
    <div
      className="app-shell"
      data-inspector-open={inspectorOpen ? "true" : "false"}
    >
      <ProjectSidebar {...sidebarProps} />

      <main className="chat-column">
        <ConversationHeader
          title={title}
          projectName={projectName}
          onNewChat={onNewChat}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
        />
        {children}
      </main>

      {inspectorOpen && <ContextInspector branch={branch} changesCount={changesCount} />}
    </div>
  );
}

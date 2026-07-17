import { useState, type ReactNode } from "react";
import { ProjectSidebar, type ProjectSidebarProps } from "./ProjectSidebar";
import { ConversationHeader } from "./ConversationHeader";
import { ContextInspector } from "./ContextInspector";

type AppShellProps = {
  children: ReactNode;
  title?: string;
  sidebarProps: ProjectSidebarProps;
};

export function AppShell({ children, title, sidebarProps }: AppShellProps) {
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
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
        />
        {children}
      </main>

      {inspectorOpen && <ContextInspector />}
    </div>
  );
}

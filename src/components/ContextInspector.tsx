import { GitBranch, FileOutput, Folders } from "lucide-react";

type ContextInspectorProps = {
  branch?: string | null;
  changesCount?: number;
};

export function ContextInspector({
  branch,
  changesCount,
}: ContextInspectorProps) {
  return (
    <aside className="context-inspector">
      <div className="inspector-card">
        <div className="inspector-card-header">
          <GitBranch size={14} />
          <span>Environment</span>
        </div>
        <div className="inspector-card-body">
          <div className="inspector-row">
            <span className="inspector-label">Branch</span>
            <span className="inspector-value">{branch ?? "—"}</span>
          </div>
          <div className="inspector-row">
            <span className="inspector-label">Changes</span>
            <span className="inspector-value">
              {changesCount !== undefined ? `${changesCount} file${changesCount === 1 ? "" : "s"}` : "—"}
            </span>
          </div>
        </div>
      </div>

      <div className="inspector-card">
        <div className="inspector-card-header">
          <FileOutput size={14} />
          <span>Outputs</span>
        </div>
        <div className="inspector-card-body">
          <p className="inspector-empty">No outputs yet</p>
        </div>
      </div>

      <div className="inspector-card">
        <div className="inspector-card-header">
          <Folders size={14} />
          <span>Sources</span>
        </div>
        <div className="inspector-card-body">
          <p className="inspector-empty">No sources for this conversation</p>
        </div>
      </div>
    </aside>
  );
}

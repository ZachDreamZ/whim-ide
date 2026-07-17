import { useState } from "react";
import { FileCode2, ChevronDown, Eye, Undo2 } from "lucide-react";
import { Button } from "./ui/button";

export type FileChange = {
  path: string;
  additions: number;
  deletions: number;
};

type FileChangeCardProps = {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
  onOpenFile?: (path: string) => void;
  canUndo?: boolean;
};

const INITIAL_DISPLAY_COUNT = 4;

export function FileChangeCard({
  files,
  totalAdditions,
  totalDeletions,
  onOpenFile,
  canUndo = false,
}: FileChangeCardProps) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? files : files.slice(0, INITIAL_DISPLAY_COUNT);

  return (
    <div className="file-change-card">
      <div className="file-change-card-header">
        <div className="file-change-card-summary">
          <FileCode2 size={16} />
          <span>
            Edited <strong>{files.length}</strong> file
            {files.length === 1 ? "" : "s"}
          </span>
          <span className="file-change-card-stats">
            <span className="text-green-400">+{totalAdditions}</span>
            <span className="text-red-400">-{totalDeletions}</span>
          </span>
        </div>
        <div className="file-change-card-actions">
          <Button variant="ghost" size="icon-sm" aria-label="Review">
            <Eye size={14} />
          </Button>
          {canUndo && (
            <Button variant="ghost" size="icon-sm" aria-label="Undo all">
              <Undo2 size={14} />
            </Button>
          )}
        </div>
      </div>
      <div className="file-change-card-list">
        {displayed.map((file) => {
          const clickable = Boolean(onOpenFile);
          return (
            <button
              key={file.path}
              type="button"
              className={
                clickable
                  ? "file-change-card-item file-change-card-item--clickable"
                  : "file-change-card-item"
              }
              disabled={!clickable}
              onClick={clickable ? () => onOpenFile?.(file.path) : undefined}
              title={clickable ? `Open ${file.path}` : undefined}
            >
              <span className="file-change-card-path">{file.path}</span>
              <span className="file-change-card-diff">
                <span className="text-green-400">+{file.additions}</span>
                <span className="text-red-400">-{file.deletions}</span>
              </span>
            </button>
          );
        })}
        {files.length > INITIAL_DISPLAY_COUNT && !showAll && (
          <button
            type="button"
            className="file-change-card-show-more"
            onClick={() => setShowAll(true)}
          >
            Show {files.length - INITIAL_DISPLAY_COUNT} more files
            <ChevronDown size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

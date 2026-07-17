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
};

const INITIAL_DISPLAY_COUNT = 4;

export function FileChangeCard({
  files,
  totalAdditions,
  totalDeletions,
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
          <Button variant="ghost" size="icon-sm" aria-label="Undo">
            <Undo2 size={14} />
          </Button>
        </div>
      </div>
      <div className="file-change-card-list">
        {displayed.map((file) => (
          <div key={file.path} className="file-change-card-item">
            <span className="file-change-card-path">{file.path}</span>
            <span className="file-change-card-diff">
              <span className="text-green-400">+{file.additions}</span>
              <span className="text-red-400">-{file.deletions}</span>
            </span>
          </div>
        ))}
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

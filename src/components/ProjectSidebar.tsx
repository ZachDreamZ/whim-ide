import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  normalizeWorkspacePath,
  workspaceEntryDepth,
  workspaceEntryName,
  workspaceParentPaths,
} from "../lib/workbench";
import type {
  LivingBrief,
  WorkspaceContextItem,
  WorkspaceEntry,
} from "../types/workbench";

export type ProjectSidebarProps = {
  workspace: string;
  activeFile: string;
  entries?: readonly WorkspaceEntry[];
  loading?: boolean;
  error?: string | null;
  truncated?: boolean;
  branch?: string | null;
  livingBrief?: LivingBrief | null;
  contextItems?: readonly WorkspaceContextItem[];
  filter?: string;
  filterShortcut?: string;
  expandedPaths?: readonly string[];
  onFilterChange?: (filter: string) => void;
  onFolderToggle?: (path: string, expanded: boolean) => void;
  onFileSelect: (path: string) => void;
  onOpenWorkspace: () => void;
  onCreateFile?: () => void;
  onOpenActions?: () => void;
  onRefresh?: () => void;
  onOpenBrief?: () => void;
};

function isCodeFile(path: string) {
  return /\.(?:[cm]?[jt]sx?|rs|py|go|java|cs|cpp|c|h|html?|css|scss|vue|svelte)$/i.test(
    path,
  );
}

function safeStatusClass(status: string) {
  return status.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function ProjectSidebar({
  workspace,
  activeFile,
  entries = [],
  loading = false,
  error,
  truncated = false,
  branch,
  livingBrief,
  contextItems = [],
  filter,
  filterShortcut,
  expandedPaths,
  onFilterChange,
  onFolderToggle,
  onFileSelect,
  onOpenWorkspace,
  onCreateFile,
  onOpenActions,
  onRefresh,
  onOpenBrief,
}: ProjectSidebarProps) {
  const [localFilter, setLocalFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(
    () => new Set(),
  );

  const projectName =
    workspace.split(/[\\/]/).filter(Boolean).pop() ?? "untitled";
  const currentFilter = filter ?? localFilter;
  const normalizedActiveFile = normalizeWorkspacePath(activeFile);
  const controlledExpanded = useMemo(
    () =>
      expandedPaths
        ? new Set(expandedPaths.map((path) => normalizeWorkspacePath(path)))
        : null,
    [expandedPaths],
  );

  const isExpanded = (path: string) => {
    const normalized = normalizeWorkspacePath(path);
    return controlledExpanded
      ? controlledExpanded.has(normalized)
      : !collapsedPaths.has(normalized);
  };

  const toggleFolder = (path: string) => {
    const normalized = normalizeWorkspacePath(path);
    const nextExpanded = !isExpanded(normalized);
    if (!controlledExpanded) {
      setCollapsedPaths((current) => {
        const next = new Set(current);
        if (nextExpanded) next.delete(normalized);
        else next.add(normalized);
        return next;
      });
    }
    onFolderToggle?.(normalized, nextExpanded);
  };

  const visibleEntries = useMemo(() => {
    const query = currentFilter.trim().toLowerCase();
    const included = new Set<string>();

    if (query) {
      for (const entry of entries) {
        const path = normalizeWorkspacePath(entry.path);
        const name = workspaceEntryName(entry);
        if (
          path.toLowerCase().includes(query) ||
          name.toLowerCase().includes(query)
        ) {
          included.add(path);
          workspaceParentPaths(path).forEach((parent) => included.add(parent));
        }
      }
    }

    return entries.filter((entry) => {
      const path = normalizeWorkspacePath(entry.path);
      if (query) return included.has(path);
      return !workspaceParentPaths(path).some((parent) =>
        controlledExpanded
          ? !controlledExpanded.has(parent)
          : collapsedPaths.has(parent),
      );
    });
  }, [collapsedPaths, controlledExpanded, currentFilter, entries]);

  const updateFilter = (value: string) => {
    if (filter === undefined) setLocalFilter(value);
    onFilterChange?.(value);
  };

  useEffect(() => {
    const focus = () => filterRef.current?.focus();
    window.addEventListener("whim:focus-files", focus);
    return () => window.removeEventListener("whim:focus-files", focus);
  }, []);

  return (
    <aside className="project-sidebar">
      <div className="sidebar-heading">
        <div>
          <span className="sidebar-eyebrow">Workspace</span>
          <strong title={workspace}>{projectName}</strong>
        </div>
        <div className="sidebar-actions">
          <button
            type="button"
            aria-label="Refresh files"
            onClick={onRefresh}
            disabled={!onRefresh || loading}
          >
            <RefreshCw className={loading ? "spin" : ""} size={13} />
          </button>
          <button
            type="button"
            aria-label="New file"
            onClick={onCreateFile}
            disabled={!onCreateFile}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            aria-label="More workspace actions"
            onClick={onOpenActions}
            disabled={!onOpenActions}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      </div>

      {livingBrief && (
        <button
          className="intent-brief"
          type="button"
          onClick={onOpenBrief}
          disabled={!onOpenBrief}
        >
          <span className="intent-icon">
            <Sparkles size={14} />
          </span>
          <span>
            <small>{livingBrief.eyebrow || "Living brief"}</small>
            <strong>{livingBrief.title}</strong>
          </span>
          <ChevronRight size={14} />
        </button>
      )}

      <div className="sidebar-search">
        <Search size={13} />
        <input
          ref={filterRef}
          aria-label="Filter files"
          placeholder="Filter files"
          value={currentFilter}
          onChange={(event) => updateFilter(event.currentTarget.value)}
        />
        {filterShortcut && <kbd>{filterShortcut}</kbd>}
      </div>

      <div className="file-section">
        <div className="file-section-label">
          <span>
            <ChevronDown size={12} /> Files
          </span>
          {branch && (
            <span className="branch-label">
              <CircleDot size={10} /> {branch}
            </span>
          )}
        </div>
        <div className="file-tree" role="tree" aria-busy={loading}>
          {loading && entries.length === 0 && (
            <div className="file-row" role="status">
              <span className="file-chevron" />
              <LoaderCircle className="spin file-icon" size={13} />
              <span>Loading workspace…</span>
            </div>
          )}

          {!loading && error && (
            <div className="file-row" role="alert" title={error}>
              <span className="file-chevron" />
              <CircleDot className="file-icon" size={13} />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && visibleEntries.length === 0 && (
            <div className="file-row" role="status">
              <span className="file-chevron" />
              <File className="file-icon" size={13} />
              <span>
                {currentFilter ? "No matching files" : "Workspace is empty"}
              </span>
            </div>
          )}

          {visibleEntries.map((entry) => {
            const path = normalizeWorkspacePath(entry.path);
            const folder = entry.kind === "directory";
            const expanded = folder && isExpanded(path);
            const Icon = folder
              ? expanded
                ? FolderOpen
                : Folder
              : isCodeFile(path)
                ? FileCode2
                : File;
            const selected = path === normalizedActiveFile;
            return (
              <button
                key={path}
                className={`file-row ${selected ? "selected" : ""}`}
                style={{ paddingLeft: 10 + workspaceEntryDepth(entry) * 13 }}
                type="button"
                onClick={() =>
                  folder ? toggleFolder(path) : onFileSelect(path)
                }
                role="treeitem"
                aria-selected={selected}
                aria-expanded={folder ? expanded : undefined}
                title={path}
              >
                {folder ? (
                  expanded ? (
                    <ChevronDown className="file-chevron" size={11} />
                  ) : (
                    <ChevronRight className="file-chevron" size={11} />
                  )
                ) : (
                  <span className="file-chevron" />
                )}
                <Icon
                  size={13}
                  className={folder ? "folder-icon" : "file-icon"}
                />
                <span>{workspaceEntryName(entry)}</span>
                {entry.status && (
                  <em
                    className={`file-status status-${safeStatusClass(entry.status)}`}
                  >
                    {entry.status}
                  </em>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sidebar-spacer" />
      {(contextItems.length > 0 || truncated) && (
        <div className="sidebar-context">
          {contextItems.map((item) => (
            <div className="context-row" key={item.id}>
              <span className={`context-dot ${item.tone || "neutral"}`} />
              {item.label}
            </div>
          ))}
          {truncated && (
            <div className="context-row">
              <span className="context-dot coral" />
              File list truncated
            </div>
          )}
        </div>
      )}
      <button
        className="open-workspace"
        type="button"
        onClick={onOpenWorkspace}
      >
        <FolderOpen size={14} /> Open another folder
      </button>
    </aside>
  );
}

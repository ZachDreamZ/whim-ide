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
  MessageSquareText,
  Plus,
  RefreshCw,
  GitPullRequest,
  Globe2,
  Search,
  Sparkles,
  Blocks,
  CalendarClock,
  Settings2,
} from "lucide-react";
import type { ViewId } from "./WorkspaceRail";
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
  activeView?: string;
  onViewChange?: (view: ViewId) => void;
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
  activeView,
  onViewChange,
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
    <aside className="w-[280px] h-full bg-[#11141b] border-r border-white/5 flex flex-col overflow-hidden shrink-0 select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#161a23]/30 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] uppercase font-bold tracking-widest text-[#8a95a5]">Workspace</span>
          <strong className="text-[#dfe3eb] text-sm font-semibold truncate" title={workspace}>{projectName}</strong>
        </div>
        <div className="flex items-center gap-1.5 text-[#8a95a5]">
          <button
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/5 hover:text-[#dfe3eb] transition-all cursor-pointer"
            type="button"
            aria-label="Refresh files"
            onClick={onRefresh}
            disabled={!onRefresh || loading}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={13} />
          </button>
          <button
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/5 hover:text-[#dfe3eb] transition-all cursor-pointer"
            type="button"
            aria-label="New file"
            onClick={onCreateFile}
            disabled={!onCreateFile}
          >
            <Plus size={14} />
          </button>
          <button
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/5 hover:text-[#dfe3eb] transition-all cursor-pointer"
            type="button"
            aria-label="More workspace actions"
            onClick={onOpenActions}
            disabled={!onOpenActions}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      </div>

      {/* GPT desktop navigation order, backed by native Whim views. */}
      {onViewChange && (
        <div className="flex flex-col gap-0.5 px-3 mb-2">
          <button className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeView === "build" ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`} onClick={() => onViewChange("build")}>
            <Sparkles size={16} /> New task
          </button>
          <button className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeView === "scheduled" ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`} onClick={() => onViewChange("scheduled")}>
            <CalendarClock size={16} /> Scheduled
          </button>
          <button className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeView === "plugins" ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`} onClick={() => onViewChange("plugins")}>
            <Blocks size={16} /> Plugins
          </button>
          <button className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeView === "sites" ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`} onClick={() => onViewChange("sites")}>
            <Globe2 size={16} /> Sites
          </button>
          <button className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeView === "pullRequests" ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`} onClick={() => onViewChange("pullRequests")}>
            <GitPullRequest size={16} /> Pull requests
          </button>
          <button className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeView === "chat" ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`} onClick={() => onViewChange("chat")}>
            <MessageSquareText size={16} /> Chat
          </button>
          <div className="h-px bg-white/5 my-1" />
          <button className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeView === "orchestrate" ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`} onClick={() => onViewChange("orchestrate")}><CircleDot size={16} /> Tasks</button>
          <button className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeView === "providers" ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`} onClick={() => onViewChange("providers")}><Settings2 size={16} /> Models & Providers</button>
          <button className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeView === "settings" ? "bg-white/10 text-white" : "text-[#ececf1] hover:bg-white/5"}`} onClick={() => onViewChange("settings")}>
            <Settings2 size={16} /> Settings
          </button>
        </div>
      )}

      {/* Living Brief */}
      {livingBrief && (
        <button
          className="m-3 p-3 bg-gradient-to-r from-[#202735] to-[#171c26] border border-white/5 rounded-xl flex items-center gap-3 text-left hover:border-white/10 hover:shadow-md transition-all cursor-pointer shrink-0"
          type="button"
          onClick={onOpenBrief}
          disabled={!onOpenBrief}
        >
          <span className="w-8 h-8 rounded-lg bg-[#ff6f4c]/10 text-[#ff6f4c] flex items-center justify-center shrink-0">
            <Sparkles size={14} className="animate-pulse" />
          </span>
          <div className="flex-1 min-w-0">
            <small className="block text-[9px] uppercase font-bold tracking-widest text-[#8a95a5]">{livingBrief.eyebrow || "Living brief"}</small>
            <strong className="block text-xs font-medium text-[#dfe3eb] truncate">{livingBrief.title}</strong>
          </div>
          <ChevronRight size={14} className="text-[#8a95a5]" />
        </button>
      )}

      {/* Search Input */}
      <div className="mx-3 mb-2 px-3 py-1.5 bg-[#151922] border border-white/5 rounded-lg flex items-center gap-2 text-[#8a95a5] shrink-0">
        <Search size={13} />
        <input
          ref={filterRef}
          className="flex-1 bg-transparent border-none outline-none text-[#dfe3eb] text-xs placeholder-[#707a8b] p-0"
          aria-label="Filter files"
          placeholder="Filter files..."
          value={currentFilter}
          onChange={(event) => updateFilter(event.currentTarget.value)}
        />
        {filterShortcut && <kbd className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 font-mono text-[#8a95a5]">{filterShortcut}</kbd>}
      </div>

      {/* File Tree Container */}
      <div className="flex-1 overflow-auto flex flex-col">
        {/* Section Header */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-white/[0.01] border-y border-white/5 text-[10px] uppercase font-bold tracking-wider text-[#8a95a5] shrink-0">
          <span className="flex items-center gap-1">
            <ChevronDown size={12} /> Files
          </span>
          {branch && (
            <span className="flex items-center gap-1 text-[#ff6f4c]/85">
              <CircleDot size={9} /> {branch}
            </span>
          )}
        </div>

        {/* Tree Entries */}
        <div className="flex-grow py-1" role="tree" aria-busy={loading}>
          {loading && entries.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-[#8a95a5]" role="status">
              <LoaderCircle className="animate-spin text-[#ff6f4c]" size={13} />
              <span>Loading workspace…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-[#ff756f] break-all" role="alert" title={error}>
              <CircleDot size={13} />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && visibleEntries.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-[#8a95a5]" role="status">
              <File size={13} />
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

            // Resolve file status styling
            const status = entry.status ? safeStatusClass(entry.status) : null;
            let statusColor = "text-[#8a95a5]";
            if (status === "added" || status === "staged" || status === "created") statusColor = "bg-green-500/10 text-green-400 border-green-500/20";
            if (status === "modified" || status === "edited") statusColor = "bg-[#ff6f4c]/10 text-[#ff6f4c] border-[#ff6f4c]/20";
            if (status === "deleted") statusColor = "bg-red-500/10 text-red-400 border-red-500/20";

            return (
              <button
                key={path}
                className={`w-full flex items-center gap-1.5 py-1 pr-4 text-left text-xs transition-all hover:bg-white/[0.02] cursor-pointer ${selected ? "bg-white/5 text-[#dfe3eb]" : "text-[#8a95a5] hover:text-[#dfe3eb]"}`}
                style={{ paddingLeft: 12 + workspaceEntryDepth(entry) * 12 }}
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
                    <ChevronDown className="text-white/40 shrink-0" size={12} />
                  ) : (
                    <ChevronRight className="text-white/40 shrink-0" size={12} />
                  )
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <Icon
                  size={14}
                  className={`shrink-0 ${folder ? "text-[#ff6f4c]/75" : selected ? "text-[#9c8cff]" : "text-[#8a95a5]"}`}
                />
                <span className="truncate flex-1 min-w-0">{workspaceEntryName(entry)}</span>

                {entry.status && (
                  <em className={`text-[9px] uppercase px-1 border rounded scale-90 ${statusColor}`}>
                    {entry.status}
                  </em>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sidebar Footer Context */}
      {(contextItems.length > 0 || truncated) && (
        <div className="px-4 py-2 border-t border-white/5 bg-black/10 flex flex-col gap-1 shrink-0">
          {contextItems.map((item) => (
            <div className="flex items-center gap-2 text-[10px] text-[#8a95a5]" key={item.id}>
              <span className={`w-1.5 h-1.5 rounded-full ${item.tone === "violet" ? "bg-[#9c8cff]" : item.tone === "mint" ? "bg-green-400" : "bg-neutral-500"}`} />
              {item.label}
            </div>
          ))}
          {truncated && (
            <div className="flex items-center gap-2 text-[10px] text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              File list truncated
            </div>
          )}
        </div>
      )}

      {/* Open workspace folder button */}
      <button
        className="w-full py-3 bg-[#161a23]/30 hover:bg-[#161a23]/60 border-t border-white/5 text-[#8a95a5] hover:text-[#dfe3eb] text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0"
        type="button"
        onClick={onOpenWorkspace}
      >
        <FolderOpen size={14} /> Open another folder
      </button>
    </aside>
  );
}

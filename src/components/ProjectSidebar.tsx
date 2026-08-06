import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Blocks,
  Boxes,
  CalendarClock,
  ChevronDown,
  Clapperboard,
  Folder,
  FolderOpen,
  GitPullRequest,
  Globe2,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Pin,
  Rocket,
  Search,
  Settings2,
  Sparkles,
  WandSparkles,
  FileCode,
  Trash2,
  FilePlus,
  FolderPlus,
} from "lucide-react";
import type { ViewId } from "../types/navigation";
import {
  bridge,
  type ChatThreadSummary,
  type OrchestrationJob,
  type WorkspaceEntry,
} from "../lib/bridge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ScrollArea } from "./ui/scroll-area";
import { isContinuationOnly } from "../lib/history";

export type ProjectSidebarProps = {
  activeView?: string;
  onViewChange?: (view: ViewId) => void;
  workspace: string;
  branch?: string | null;
  loading?: boolean;
  onOpenWorkspace: () => void;
  onRefresh?: () => void;
  onTaskSelect?: (job: OrchestrationJob) => void;
  onChatSelect?: (thread: ChatThreadSummary) => void;
  files?: readonly WorkspaceEntry[];
  onFileSelect?: (path: string) => void;
  onFileCreate?: (path: string, content: string) => Promise<void>;
  onFileDelete?: (path: string) => Promise<void>;
  onFolderCreate?: (path: string) => Promise<void>;
  onChatDelete?: (id: string) => Promise<void>;
};

const primaryItems = [
  { id: "build", label: "New chat", icon: Sparkles },
  { id: "scheduled", label: "Scheduled", icon: CalendarClock },
  { id: "plugins", label: "Plugins", icon: Sparkles },
] satisfies { id: ViewId; label: string; icon: typeof Sparkles }[];

const moreItems = [
  { id: "sites", label: "Sites", icon: Globe2 },
  { id: "services", label: "Services", icon: Boxes },
  { id: "ecosystem", label: "Ecosystem", icon: Blocks },
  { id: "pullRequests", label: "Pull requests", icon: GitPullRequest },
  { id: "chat", label: "Chat", icon: MessageSquareText },
  { id: "browser", label: "Browser", icon: Globe2 },
  { id: "creative", label: "Creative studio", icon: Clapperboard },
  { id: "providers", label: "Models & providers", icon: Settings2 },
  { id: "ship", label: "Ship", icon: Rocket },
  { id: "autopilot", label: "Autopilot", icon: WandSparkles },
] satisfies { id: ViewId; label: string; icon: typeof Sparkles }[];

function normalized(value: string) {
  return value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

function projectName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function recentLabel(value: number) {
  const age = Date.now() - value;
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.max(1, Math.floor(age / 60_000))}m`;
  if (age < 86_400_000) return `${Math.max(1, Math.floor(age / 3_600_000))}h`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}

function taskTone(status: OrchestrationJob["status"]) {
  if (status === "running") return "bg-primary";
  if (status === "failed" || status === "interrupted") return "bg-[#f59e0b]";
  if (status === "completed") return "bg-[#34d399]";
  return "bg-muted-foreground/60";
}

const PINNED_KEY = "whim:pinned";

function loadPinned(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function savePinned(items: string[]) {
  localStorage.setItem(PINNED_KEY, JSON.stringify(items));
}

export function ProjectSidebar({
  activeView,
  onViewChange,
  workspace,
  branch,
  loading = false,
  onOpenWorkspace,
  onRefresh,
  onTaskSelect,
  onChatSelect,
  files,
  onFileSelect,
  onFileCreate,
  onFileDelete,
  onFolderCreate,
  onChatDelete,
}: ProjectSidebarProps) {
  const native = bridge.isNative();
  const [jobs, setJobs] = useState<OrchestrationJob[]>([]);
  const [chats, setChats] = useState<ChatThreadSummary[]>([]);
  const [query, setQuery] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinned);

  const persistPinned = useCallback((ids: string[]) => {
    setPinnedIds(ids);
    savePinned(ids);
  }, []);

  const togglePin = useCallback(
    (id: string) => {
      if (pinnedIds.includes(id)) {
        persistPinned(pinnedIds.filter((x) => x !== id));
      } else {
        persistPinned([id, ...pinnedIds]);
      }
    },
    [pinnedIds, persistPinned]
  );

  const refreshHistory = useCallback(async () => {
    if (!native) return;
    setHistoryLoading(true);
    const [jobResult, chatResult] = await Promise.allSettled([
      bridge.listProjectOrchestrationJobs(),
      bridge.listChatThreads(),
    ]);
    if (jobResult.status === "fulfilled") setJobs(jobResult.value);
    if (chatResult.status === "fulfilled") setChats(chatResult.value);
    setHistoryLoading(false);
  }, [native]);

  useEffect(() => {
    void refreshHistory();
    if (!native) return;
    const timer = window.setInterval(() => void refreshHistory(), 5_000);
    const refresh = () => void refreshHistory();
    window.addEventListener("whim:history-changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("whim:history-changed", refresh);
    };
  }, [native, refreshHistory]);

  const filteredJobs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs
      .filter((job) => {
        if (isContinuationOnly(job.title)) return false;
        return !needle || `${job.title} ${job.workspace}`.toLowerCase().includes(needle);
      })
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  }, [jobs, query]);

  const filteredChats = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return chats.filter((chat) => {
      if (isContinuationOnly(chat.title)) return false;
      return !needle || `${chat.title} ${chat.preview}`.toLowerCase().includes(needle);
    });
  }, [chats, query]);

  const pinnedItems = useMemo(() => {
    const all = [
      ...filteredJobs.map((j) => ({ id: j.id, title: j.title, kind: "job" as const, updatedAtMs: j.updatedAtMs })),
      ...filteredChats.map((c) => ({ id: c.id, title: c.title, kind: "chat" as const, updatedAtMs: c.updatedAtMs })),
    ];
    return all.filter((item) => pinnedIds.includes(item.id));
  }, [filteredJobs, filteredChats, pinnedIds]);

  const projects = useMemo(() => {
    const grouped = new Map<string, { path: string; jobs: OrchestrationJob[]; chats: ChatThreadSummary[] }>();
    const activeKey = normalized(workspace);
    if (workspace && workspace !== "No workspace open") {
      grouped.set(activeKey, { path: workspace, jobs: [], chats: [] });
    }
    for (const job of filteredJobs) {
      const key = normalized(job.workspace);
      const group = grouped.get(key) ?? { path: job.workspace, jobs: [], chats: [] };
      group.jobs.push(job);
      grouped.set(key, group);
    }
    // Group chat threads under their workspace project
    for (const chat of filteredChats) {
      const chatWs = chat.workspace;
      if (chatWs) {
        const key = normalized(chatWs);
        const group = grouped.get(key) ?? { path: chatWs, jobs: [], chats: [] };
        group.chats.push(chat);
        grouped.set(key, group);
      }
    }
    return [...grouped.values()]
      .filter((g) => g.path)
      .sort((left, right) => {
        if (normalized(left.path) === activeKey) return -1;
        if (normalized(right.path) === activeKey) return 1;
        return (right.jobs[0]?.updatedAtMs ?? 0) - (left.jobs[0]?.updatedAtMs ?? 0);
      });
  }, [filteredJobs, filteredChats, workspace]);

  // Chats not attached to the current workspace (or with no workspace at all)
  const unattachedChats = useMemo(() => {
    const activeKey = normalized(workspace);
    return filteredChats.filter((chat) => {
      if (!chat.workspace) return true;
      return normalized(chat.workspace) !== activeKey;
    });
  }, [filteredChats, workspace]);

  return (
    <aside className="flex h-full w-[var(--sidebar-width)] shrink-0 select-none flex-col overflow-hidden border-r border-border bg-background" aria-label="Whim sidebar">
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <strong className="font-heading text-[15px] font-semibold tracking-[-0.02em]">Whim</strong>
        <Button variant="ghost" size="icon-sm" aria-label="Search" onClick={() => document.getElementById("whim-sidebar-search")?.focus()}>
          <Search size={16} />
        </Button>
      </div>

      <nav className="space-y-0.5 px-2" aria-label="Primary">
        {primaryItems.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            className={`h-8 w-full justify-start gap-2 px-2 text-[13px] ${activeView === id ? "bg-accent text-foreground" : "text-foreground/90 hover:bg-accent"}`}
            onClick={() => onViewChange?.(id)}
          >
            <Icon size={16} /> {label}
          </Button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 w-full justify-start gap-2 px-2 text-[13px] text-foreground/90" />}>
            <MoreHorizontal size={16} /> More
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-52">
            {moreItems.map(({ id, label, icon: Icon }) => (
              <DropdownMenuItem key={id} onClick={() => onViewChange?.(id)}>
                <Icon size={16} /> {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      {/* Search */}
      <div className="mx-3 mt-2 flex h-7 items-center gap-2 rounded-lg border border-border bg-white/[0.02] px-2 text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
        <Search className="size-3 text-muted-foreground" />
        <Input
          id="whim-sidebar-search"
          className="h-6 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
          placeholder="Search history"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {(historyLoading || loading) && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
      </div>

      <ScrollArea className="mt-2 min-h-0 flex-1">
        {/* Workspace Files */}
        {workspace && workspace !== "No workspace open" && files && files.length > 0 && (
          <section className="px-2 pb-2 border-b border-border/40" aria-labelledby="files-heading">
            <div className="flex h-6 items-center justify-between px-2 text-[11px] font-medium text-muted-foreground">
              <span id="files-heading" className="flex items-center gap-1.5"><FolderOpen size={12} /> Workspace Files</span>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Create folder"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const path = prompt("Enter new folder path relative to workspace root (e.g., src/components):");
                    if (path && path.trim()) {
                      await onFolderCreate?.(path.trim());
                    }
                  }}
                >
                  <FolderPlus size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Create file"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const path = prompt("Enter new file path relative to workspace root (e.g., src/utils.ts):");
                    if (path && path.trim()) {
                      await onFileCreate?.(path.trim(), "// Created by Whim Standalone Workspace\n");
                    }
                  }}
                >
                  <FilePlus size={14} />
                </Button>
              </div>
            </div>
            <div className="space-y-0.5 mt-1 max-h-56 overflow-y-auto pr-1">
              {files
                .filter((f) => f.kind === "directory")
                .map((dir) => (
                  <div
                    key={dir.path}
                    className="group flex h-7 w-full items-center justify-between rounded-lg px-2 text-left text-xs text-foreground/80 hover:bg-accent cursor-default select-none"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Folder size={13} className="text-zinc-500 shrink-0" />
                      <span className="truncate font-mono text-[11px] text-zinc-400">{dir.path}</span>
                    </div>
                  </div>
                ))}
              {files
                .filter((f) => f.kind === "file")
                .map((file) => (
                  <div
                    key={file.path}
                    className="group flex h-7 w-full items-center justify-between rounded-lg px-2 text-left text-xs text-foreground/80 hover:bg-accent cursor-pointer"
                    onClick={() => onFileSelect?.(file.path)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileCode size={13} className="text-zinc-500 shrink-0" />
                      <span className="truncate font-mono text-[11px] text-zinc-300">{file.path}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 text-red-500 hover:text-red-400 p-0 hover:bg-zinc-800 transition rounded"
                      title="Delete file"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(`Are you sure you want to delete ${file.path}?`)) {
                          await onFileDelete?.(file.path);
                        }
                      }}
                    >
                      <Trash2 size={11} />
                    </Button>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* Pinned */}
        {pinnedItems.length > 0 && (
          <section className="px-2 pb-2" aria-labelledby="pinned-heading">
            <div className="flex h-6 items-center px-2 text-[11px] font-medium text-muted-foreground" id="pinned-heading">
              <Pin size={12} className="mr-1.5" /> Pinned
            </div>
            {pinnedItems.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                className="h-7 w-full justify-start gap-2 px-2 text-xs font-normal"
                title={item.title}
                onClick={() => {
                  if (item.kind === "job") {
                    const job = filteredJobs.find((j) => j.id === item.id);
                    if (job) onTaskSelect?.(job);
                  } else {
                    const chat = filteredChats.find((c) => c.id === item.id);
                    if (chat) onChatSelect?.(chat);
                  }
                }}
              >
                <Sparkles size={12} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
              </Button>
            ))}
          </section>
        )}

        {/* Projects */}
        <section className="px-2 pb-2" aria-labelledby="projects-heading">
          <div className="flex h-6 items-center justify-between px-2 text-[11px] font-medium text-muted-foreground">
            <span id="projects-heading">Projects</span>
            <Button variant="ghost" size="icon-xs" aria-label="Add project" onClick={onOpenWorkspace}><Plus size={14} /></Button>
          </div>
          <div className="space-y-0.5">
            {projects.map((project) => {
              const active = normalized(project.path) === normalized(workspace);
              const projectJobs = project.jobs.slice(0, 8);
              const projectChats = project.chats.slice(0, 8);
              const isEmpty = projectJobs.length === 0 && projectChats.length === 0;
              return (
                <Collapsible key={normalized(project.path)} defaultOpen={active || query.length > 0}>
                  <CollapsibleTrigger className="group flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-foreground/90 hover:bg-accent">
                    {active ? <FolderOpen className="size-3.5 text-primary" /> : <Folder className="size-3.5 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{projectName(project.path)}</span>
                    <ChevronDown className="size-3 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="ml-3 border-l border-border pl-1">
                    {isEmpty ? (
                      <p className="px-2 py-1 text-[11px] text-muted-foreground">No conversations yet</p>
                    ) : (
                      <>
                        {projectJobs.map((job) => (
                          <Button
                            key={job.id}
                            variant="ghost"
                            className="h-7 w-full justify-start gap-2 px-2 py-1 text-left text-xs font-normal"
                            title={job.title}
                            onClick={() => onTaskSelect?.(job)}
                            onContextMenu={(e) => { e.preventDefault(); togglePin(job.id); }}
                          >
                            <span className={`size-1.5 shrink-0 rounded-full ${taskTone(job.status)}`} />
                            <span className="min-w-0 flex-1 truncate">{job.title}</span>
                            <time className="text-[10px] text-muted-foreground">{recentLabel(job.updatedAtMs)}</time>
                          </Button>
                        ))}
                        {projectChats.map((chat) => (
                          <div
                            key={chat.id}
                            className="group/chat flex h-7 w-full items-center justify-between rounded-lg px-2 text-left text-xs text-foreground/80 hover:bg-accent cursor-pointer"
                            onClick={() => onChatSelect?.(chat)}
                            onContextMenu={(e) => { e.preventDefault(); togglePin(chat.id); }}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <MessageSquareText size={12} className="shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="opacity-0 group-hover/chat:opacity-100 h-5 w-5 text-red-500 hover:text-red-400 p-0 hover:bg-zinc-800 transition rounded"
                              title="Delete conversation"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (confirm(`Are you sure you want to delete "${chat.title}"?`)) {
                                  await onChatDelete?.(chat.id);
                                }
                              }}
                            >
                              <Trash2 size={11} />
                            </Button>
                          </div>
                        ))}
                      </>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </section>

        {/* Unattached Chats */}
        {unattachedChats.length > 0 && (
          <section className="px-2 pb-3" aria-labelledby="chats-heading">
            <div className="flex h-6 items-center px-2 text-[11px] font-medium text-muted-foreground" id="chats-heading">Chats</div>
            {unattachedChats.slice(0, 8).map((chat) => (
              <div
                key={chat.id}
                className="group/chat flex h-7 w-full items-center justify-between rounded-lg px-2 text-left text-xs text-foreground/80 hover:bg-accent cursor-pointer"
                onClick={() => onChatSelect?.(chat)}
                onContextMenu={(e) => { e.preventDefault(); togglePin(chat.id); }}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <MessageSquareText size={12} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 group-hover/chat:opacity-100 h-5 w-5 text-red-500 hover:text-red-400 p-0 hover:bg-zinc-800 transition rounded"
                  title="Delete conversation"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (confirm(`Are you sure you want to delete "${chat.title}"?`)) {
                      await onChatDelete?.(chat.id);
                    }
                  }}
                >
                  <Trash2 size={11} />
                </Button>
              </div>
            ))}
          </section>
        )}
      </ScrollArea>

      {/* Bottom */}
      <div className="border-t border-border px-2 py-2">
        <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-muted-foreground/40" />
          <span>API usage — idle</span>
        </div>
        <div className="mb-1 flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
          <span className={`size-1.5 shrink-0 rounded-full ${workspace !== "No workspace open" ? "bg-primary" : "bg-muted-foreground/60"}`} />
          <span className="min-w-0 flex-1 truncate">{workspace !== "No workspace open" ? projectName(workspace) : "No project open"}</span>
          {branch && <span className="truncate font-mono text-[9px]">{branch}</span>}
        </div>
        <Button variant="ghost" className="h-7 w-full justify-start gap-2 px-2 text-xs" onClick={() => onViewChange?.("settings")}>
          <Settings2 size={14} /> Settings
        </Button>
        <Button variant="ghost" className="h-7 w-full justify-start gap-2 px-2 text-xs" onClick={() => { onRefresh?.(); void refreshHistory(); }}>
          <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary text-[8px] font-semibold text-[#08110d]">W</span>
          Whim workspace
        </Button>
      </div>
    </aside>
  );
}

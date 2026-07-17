import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Blocks,
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
  Orbit,
  Plus,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { ViewId } from "./WorkspaceRail";
import {
  bridge,
  type ChatThreadSummary,
  type OrchestrationJob,
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
};

const primaryItems = [
  { id: "build", label: "New task", icon: Sparkles },
  { id: "scheduled", label: "Scheduled", icon: CalendarClock },
  { id: "plugins", label: "Plugins", icon: Blocks },
  { id: "sites", label: "Sites", icon: Globe2 },
  { id: "pullRequests", label: "Pull requests", icon: GitPullRequest },
  { id: "chat", label: "Chat", icon: MessageSquareText },
  { id: "browser", label: "Browser", icon: Globe2 },
] satisfies { id: ViewId; label: string; icon: typeof Sparkles }[];

const moreItems = [
  { id: "eve", label: "Eve agents", icon: Orbit },
  { id: "creative", label: "Creative studio", icon: Clapperboard },
  { id: "providers", label: "Models & providers", icon: Settings2 },
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
  if (status === "failed" || status === "interrupted") return "bg-amber-400";
  if (status === "completed") return "bg-emerald-400";
  return "bg-muted-foreground";
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
}: ProjectSidebarProps) {
  const native = bridge.isNative();
  const [jobs, setJobs] = useState<OrchestrationJob[]>([]);
  const [chats, setChats] = useState<ChatThreadSummary[]>([]);
  const [query, setQuery] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);

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
      .filter((job) => !needle || `${job.title} ${job.workspace}`.toLowerCase().includes(needle))
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  }, [jobs, query]);

  const projects = useMemo(() => {
    const grouped = new Map<string, { path: string; jobs: OrchestrationJob[] }>();
    const activeKey = normalized(workspace);
    if (workspace && workspace !== "No workspace open") {
      grouped.set(activeKey, { path: workspace, jobs: [] });
    }
    for (const job of filteredJobs) {
      const key = normalized(job.workspace);
      const group = grouped.get(key) ?? { path: job.workspace, jobs: [] };
      group.jobs.push(job);
      grouped.set(key, group);
    }
    return [...grouped.values()].sort((left, right) => {
      if (normalized(left.path) === activeKey) return -1;
      if (normalized(right.path) === activeKey) return 1;
      return (right.jobs[0]?.updatedAtMs ?? 0) - (left.jobs[0]?.updatedAtMs ?? 0);
    });
  }, [filteredJobs, workspace]);

  const filteredChats = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return chats.filter((chat) => !needle || `${chat.title} ${chat.preview}`.toLowerCase().includes(needle));
  }, [chats, query]);

  return (
    <aside className="flex h-full w-[268px] shrink-0 select-none flex-col overflow-hidden border-r border-border bg-background" aria-label="Whim home navigation">
      <div className="flex h-12 items-center justify-between px-3">
        <strong className="font-heading text-[15px] font-semibold tracking-[-0.02em]">Whim</strong>
        <Button variant="ghost" size="icon-sm" aria-label="Search projects and tasks" onClick={() => document.getElementById("whim-home-search")?.focus()}>
          <Search />
        </Button>
      </div>

      <nav className="space-y-0.5 px-2" aria-label="Home">
        {primaryItems.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            className={`h-8 w-full justify-start px-2 text-[13px] ${activeView === id ? "bg-muted text-foreground" : "text-foreground/90"}`}
            onClick={() => onViewChange?.(id)}
          >
            <Icon /> {label}
          </Button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 w-full justify-start px-2 text-[13px] text-foreground/90" />}>
            <MoreHorizontal /> More
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-52">
            {moreItems.map(({ id, label, icon: Icon }) => (
              <DropdownMenuItem key={id} onClick={() => onViewChange?.(id)}>
                <Icon /> {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      <div className="mx-3 mt-3 flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-2 text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
        <Search className="size-3.5" />
        <Input
          id="whim-home-search"
          className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
          placeholder="Search history"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {(historyLoading || loading) && <LoaderCircle className="size-3 animate-spin" />}
      </div>

      <ScrollArea className="mt-3 min-h-0 flex-1">
        <section className="px-2 pb-3" aria-labelledby="projects-heading">
          <div className="flex h-7 items-center justify-between px-2 text-xs text-muted-foreground">
            <span id="projects-heading">Projects</span>
            <Button variant="ghost" size="icon-xs" aria-label="Add project" onClick={onOpenWorkspace}><Plus /></Button>
          </div>
          <div className="space-y-0.5">
            {projects.map((project) => {
              const active = normalized(project.path) === normalized(workspace);
              return (
                <Collapsible key={normalized(project.path)} defaultOpen={active || query.length > 0}>
                  <CollapsibleTrigger className="group flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground/90 hover:bg-muted">
                    {active ? <FolderOpen className="size-4 text-primary" /> : <Folder className="size-4 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{projectName(project.path)}</span>
                    <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="ml-4 border-l border-border pl-1">
                    {project.jobs.length === 0 ? (
                      <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No tasks yet</p>
                    ) : project.jobs.slice(0, 8).map((job) => (
                      <Button key={job.id} variant="ghost" className="h-auto min-h-7 w-full justify-start gap-2 px-2 py-1 text-left text-xs font-normal" title={job.title} onClick={() => onTaskSelect?.(job)}>
                        <span className={`size-1.5 shrink-0 rounded-full ${taskTone(job.status)}`} />
                        <span className="min-w-0 flex-1 truncate">{job.title}</span>
                        <time className="text-[10px] text-muted-foreground">{recentLabel(job.updatedAtMs)}</time>
                      </Button>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </section>

        <section className="px-2 pb-3" aria-labelledby="tasks-heading">
          <div className="flex h-7 items-center px-2 text-xs text-muted-foreground" id="tasks-heading">Recent tasks</div>
          {filteredJobs.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">Completed and active Vibe runs appear here.</p>
          ) : filteredJobs.slice(0, 10).map((job) => (
            <Button key={job.id} variant="ghost" className="h-8 w-full justify-start gap-2 px-2 text-xs font-normal" title={`${projectName(job.workspace)} · ${job.title}`} onClick={() => onTaskSelect?.(job)}>
              <span className={`size-1.5 shrink-0 rounded-full ${taskTone(job.status)}`} />
              <span className="min-w-0 flex-1 truncate">{job.title}</span>
            </Button>
          ))}
        </section>

        {filteredChats.length > 0 && (
          <section className="px-2 pb-4" aria-labelledby="chats-heading">
            <div className="flex h-7 items-center px-2 text-xs text-muted-foreground" id="chats-heading">Chats</div>
            {filteredChats.slice(0, 8).map((chat) => (
              <Button key={chat.id} variant="ghost" className="h-8 w-full justify-start gap-2 px-2 text-xs font-normal" title={chat.title} onClick={() => onChatSelect?.(chat)}>
                <MessageSquareText className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
              </Button>
            ))}
          </section>
        )}
      </ScrollArea>

      <div className="border-t border-border p-2">
        <div className="mb-1 flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
          <span className={`size-1.5 rounded-full ${workspace !== "No workspace open" ? "bg-emerald-400" : "bg-muted-foreground"}`} />
          <span className="min-w-0 flex-1 truncate">{workspace !== "No workspace open" ? projectName(workspace) : "No project open"}</span>
          {branch && <span className="truncate font-mono text-[9px]">{branch}</span>}
        </div>
        <Button variant="ghost" className="h-8 w-full justify-start px-2 text-[13px]" onClick={() => onViewChange?.("settings")}>
          <Settings2 /> Settings
        </Button>
        <Button variant="ghost" className="h-8 w-full justify-start px-2 text-[13px]" onClick={() => { onRefresh?.(); void refreshHistory(); }}>
          <span className="grid size-5 place-items-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">W</span>
          Whim workspace
        </Button>
      </div>
    </aside>
  );
}

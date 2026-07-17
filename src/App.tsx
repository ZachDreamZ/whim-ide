import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Check,
  CloudOff,
  FolderOpen,
  GitBranch,
  Radio,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import "./App.css";
import { Titlebar } from "./components/Titlebar";
import { type ViewId } from "./components/WorkspaceRail";
import { ProjectSidebar } from "./components/ProjectSidebar";
const ChatHub = lazy(() => import("./components/ChatHub").then(m => ({ default: m.ChatHub })));
const CreativeStudio = lazy(() => import("./components/CreativeStudio").then(m => ({ default: m.CreativeStudio })));
const ProviderHub = lazy(() => import("./components/ProviderHub").then(m => ({ default: m.ProviderHub })));
const EcosystemHub = lazy(() => import("./components/EcosystemHub").then(m => ({ default: m.EcosystemHub })));
const ScheduledTasksHub = lazy(() => import("./components/ScheduledTasksHub").then(m => ({ default: m.ScheduledTasksHub })));
const PluginsHub = lazy(() => import("./components/PluginsHub").then(m => ({ default: m.PluginsHub })));
const SitesHub = lazy(() => import("./components/SitesHub").then(m => ({ default: m.SitesHub })));
const PullRequestsHub = lazy(() => import("./components/PullRequestsHub").then(m => ({ default: m.PullRequestsHub })));
const NativeBrowserHub = lazy(() => import("./components/NativeBrowserHub").then(m => ({ default: m.NativeBrowserHub })));
const ShipHub = lazy(() => import("./components/ShipHub").then(m => ({ default: m.ShipHub })));
const AutopilotHub = lazy(() => import("./components/AutopilotHub").then(m => ({ default: m.AutopilotHub })));
import { AgentChatView } from "./components/AgentChatView";
import { AppShell } from "./components/AppShell";
import { CommandPalette } from "./components/CommandPalette";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsLayout } from "./components/settings/SettingsLayout";
import { GeneralSettings } from "./components/settings/pages/GeneralSettings";
import { AppearanceSettings } from "./components/settings/pages/AppearanceSettings";
import { VoiceSettings } from "./components/settings/pages/VoiceSettings";
import { ComputerUseSettings } from "./components/settings/pages/ComputerUseSettings";
import { PersonalizationSettings } from "./components/settings/pages/PersonalizationSettings";
import { ChatSettings } from "./components/settings/pages/ChatSettings";
import { ConfigurationSettings } from "./components/settings/pages/ConfigurationSettings";
import { KeyboardShortcutsSettings } from "./components/settings/pages/KeyboardShortcutsSettings";
import {
  bridge,
  defaultAppSettings,
  type AppSettings,
  type CredentialReport,
  type EnvironmentReport,
  type OrchestrationJob,
  type ChatThreadSummary,
  type WorkspaceInfo,
} from "./lib/bridge";
import { inspectProject, parseGitState, type ProjectProfile } from "./lib/project";
import { providerHasEnvironmentCredential } from "./lib/provider-credentials";
import type { WorkspaceEntry, WorkbenchFileChange } from "./types/workbench";

const defaultEnvironment: EnvironmentReport = { platform: "Windows", tools: [] };
const defaultCredentials: CredentialReport = { environmentNames: [], envFiles: [] };
const defaultProfile: ProjectProfile = { framework: null, packageManager: null, checkCommand: null, devCommand: null };

type ReadOnlyFile = { path: string; content: string; scrollToLine?: number | null };

function App() {
  const [view, setView] = useState<ViewId>("build");
  const [chatResetKey, setChatResetKey] = useState(0);
  const [chatTitle, setChatTitle] = useState("New chat");

  const handleViewChange = useCallback((nextView: ViewId) => {
    if (nextView === "build" && view === "build") {
      // Already on build view — treat as "New chat"
      setChatResetKey((k) => k + 1);
    }
    setView(nextView);
  }, [view]);

  const handleNewChat = useCallback(() => {
    setChatResetKey((k) => k + 1);
    setActiveThreadId(null);
    setView("build");
  }, []);
  const [activeSettingsCategory, setActiveSettingsCategory] = useState("general");
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);

  const [treeLoading, setTreeLoading] = useState(false);
  const [, setTreeError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState("");
  const [readOnlyFile, setReadOnlyFile] = useState<ReadOnlyFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [, setOpenedJobId] = useState<string | null>(null);


  const [models] = useState<string[]>([]);
  const [agentProvider, setAgentProvider] = useState(() => localStorage.getItem("whim:agent:provider") ?? "auto");
  const [agentApiKey, setAgentApiKey] = useState("");
  const [agentBaseUrl, setAgentBaseUrl] = useState(() => localStorage.getItem("whim:agent:baseUrl") ?? "");
  const [agentModel, setAgentModel] = useState(() => localStorage.getItem("whim:agent:model") ?? "");
  const [environment, setEnvironment] = useState<EnvironmentReport>(defaultEnvironment);
  const [credentials, setCredentials] = useState<CredentialReport>(defaultCredentials);
  const [_entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [, setProfile] = useState<ProjectProfile>(defaultProfile);
  const [branch, setBranch] = useState<string | null>(null);
  const [changes, setChanges] = useState<WorkbenchFileChange[]>([]);
  const [, setActivity] = useState<"idle" | "agent" | "checking" | "deploying">("idle");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const booted = useRef(false);
  const fileRequest = useRef(0);
  const settingsRevision = useRef(0);
  const settingsSaveChain = useRef<Promise<unknown>>(Promise.resolve());
  const scheduleRunnerActive = useRef(false);

  useEffect(() => { localStorage.setItem("whim:agent:provider", agentProvider); }, [agentProvider]);
  // API key is session-memory only; never persisted to localStorage.
  useEffect(() => { localStorage.setItem("whim:agent:baseUrl", agentBaseUrl); }, [agentBaseUrl]);
  useEffect(() => { localStorage.setItem("whim:agent:model", agentModel); }, [agentModel]);

  const updateAppSettings = useCallback((next: AppSettings) => {
    setAppSettings(next);
    if (!bridge.isNative()) return;
    const revision = ++settingsRevision.current;
    setSettingsSaving(true);
    settingsSaveChain.current = settingsSaveChain.current
      .catch(() => undefined)
      .then(() => bridge.saveAppSettings(next))
      .then((saved) => {
        if (revision === settingsRevision.current) setAppSettings(saved);
      })
      .catch((error) => {
        if (revision === settingsRevision.current) {
          setToast(`Settings were not saved: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
      .finally(() => {
        if (revision === settingsRevision.current) setSettingsSaving(false);
      });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const contrast = Math.max(0, Math.min(100, appSettings.appearance.contrast));
    root.style.setProperty("--primary", appSettings.appearance.accent);
    root.style.setProperty("--ring", appSettings.appearance.accent);
    root.style.setProperty("--mint", appSettings.appearance.accent);
    root.style.setProperty("--font-body", `"${appSettings.appearance.uiFont}", "Segoe UI Variable", sans-serif`);
    root.style.setProperty("--font-code", `"${appSettings.appearance.codeFont}", Consolas, monospace`);
    root.style.setProperty("--border", `rgba(255, 255, 255, ${(0.035 + contrast * 0.00115).toFixed(3)})`);
    root.style.setProperty("--line-strong", `rgba(255, 255, 255, ${(0.08 + contrast * 0.0014).toFixed(3)})`);
    root.style.fontSize = `${appSettings.appearance.uiFontSize}px`;
    root.style.setProperty("--code-font-size", `${appSettings.appearance.codeFontSize}px`);
    root.classList.toggle("pointer-cursors", appSettings.appearance.pointerCursors);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => root.classList.toggle("reduce-motion", appSettings.appearance.reduceMotion === "on" || (appSettings.appearance.reduceMotion === "system" && motion.matches));
    applyMotion();
    motion.addEventListener("change", applyMotion);
    return () => motion.removeEventListener("change", applyMotion);
  }, [appSettings.appearance]);

  const workspacePath = workspace?.path ?? null;
  const projectName = workspace?.name ?? "No workspace";

  useEffect(() => {
    if (!workspacePath || !bridge.isNative()) return;
    const runDue = async () => {
      if (scheduleRunnerActive.current) return;
      scheduleRunnerActive.current = true;
      try {
        const due = await bridge.claimDueScheduledTasks(workspacePath);
        for (const task of due) {
          try {
            const job = await bridge.createOrchestrationJob({ workspace: workspacePath, intent: task.prompt, title: task.title, mode: task.mode, provider: task.provider ?? undefined, model: task.model ?? undefined });
            await bridge.markScheduledTaskRun(workspacePath, task.id, job.id);
            await bridge.dispatchOrchestrationJob({ workspace: workspacePath, jobId: job.id });
            setToast(`Scheduled task started: ${task.title}`);
          } catch {
            await bridge.saveScheduledTask({ workspace: workspacePath, id: task.id, title: task.title, prompt: task.prompt, recurrence: task.recurrence, nextRunAtMs: Date.now() + 60_000, enabled: true, mode: task.mode, provider: task.provider ?? undefined, model: task.model ?? undefined }).catch(() => undefined);
          }
        }
      } finally { scheduleRunnerActive.current = false; }
    };
    void runDue();
    const timer = window.setInterval(() => void runDue(), 30_000);
    return () => window.clearInterval(timer);
  }, [workspacePath]);

  const runModel = agentModel;
  const onRunModelChange = setAgentModel;
  const agentReady = agentProvider === "auto"
    || agentProvider === "local"
    || agentProvider === "omniroute"
    || agentApiKey.trim().length > 0
    || providerHasEnvironmentCredential(agentProvider, credentials.environmentNames);

  const refreshProviders = useCallback(async () => {
    const [environmentResult, credentialsResult] = await Promise.allSettled([
      bridge.environment(), bridge.credentials(),
    ]);
    if (environmentResult.status === "fulfilled") setEnvironment(environmentResult.value);
    if (credentialsResult.status === "fulfilled") setCredentials(credentialsResult.value);
  }, []);

  const loadReadOnlyFile = useCallback(async (root: string, path: string, line?: number) => {
    const request = ++fileRequest.current;
    setActiveFile(path);
    setReadOnlyFile(null);
    setFileError(null);
    setFileLoading(true);
    // Safety timeout: release the loading state after 30s even if the backend
    // never responds, so the viewer does not show an infinite spinner.
    const safetyTimer = window.setTimeout(() => {
      if (fileRequest.current === request) {
        setFileLoading(false);
        setFileError("Reading the file timed out. The backend may be unresponsive.");
      }
    }, 30_000);
    try {
      const content = await bridge.readFile(root, path);
      clearTimeout(safetyTimer);
      if (request !== fileRequest.current) return;
      setReadOnlyFile({ path, content, scrollToLine: line ?? null });
      localStorage.setItem(`whim:last-file:${root}`, path);
    } catch (error) {
      clearTimeout(safetyTimer);
      if (request !== fileRequest.current) return;
      const message = error instanceof Error ? error.message : `Could not read ${path}.`;
      setFileError(message);
      setToast(message);
    } finally {
      clearTimeout(safetyTimer);
      if (request === fileRequest.current) setFileLoading(false);
    }
  }, []);

  const loadGitState = useCallback(async (root: string) => {
    const [status, numstat] = await Promise.all([
      bridge.runCommand(root, "git status --porcelain=v1 --branch", { operationId: crypto.randomUUID(), timeoutMs: 30_000 }),
      bridge.runCommand(root, "git diff --numstat -- .", { operationId: crypto.randomUUID(), timeoutMs: 30_000 }),
    ]);
    if (!status.success) { setBranch(null); setChanges([]); return; }
    const parsed = parseGitState(status.stdout ?? "", numstat.success ? numstat.stdout ?? "" : "");
    setBranch(parsed.branch);
    setChanges(parsed.changes);
  }, []);

  const loadTreeAndProfile = useCallback(async (root: string) => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const nextEntries = await bridge.listWorkspace(root) as WorkspaceEntry[];
      setEntries(nextEntries);
      const packageEntry = nextEntries.find((entry) => entry.kind === "file" && entry.path.replace(/\\/g, "/").toLowerCase() === "package.json");
      const packageJson = packageEntry ? await bridge.readFile(root, packageEntry.path).catch(() => null) : null;
      const nextProfile = inspectProject(nextEntries, packageJson);
      setProfile(nextProfile);
      return nextEntries;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read workspace files.";
      setTreeError(message);
      setEntries([]);
      throw error;
    } finally { setTreeLoading(false); }
  }, []);

  const activateWorkspace = useCallback(async (info: WorkspaceInfo) => {
    setEntries([]);
    setWorkspace(info);
    localStorage.setItem("whim:recent-workspace", info.path);
    setTreeError(null);
    setFileError(null);
    setActiveFile("");
    setReadOnlyFile(null);
    setChanges([]);
    await bridge.ensureProjectContext(info.path).catch((error) => {
      setToast(`Project context was not initialized: ${error instanceof Error ? error.message : String(error)}`);
    });
    await loadTreeAndProfile(info.path);
    void loadGitState(info.path);
    void refreshProviders();
    window.dispatchEvent(new Event("whim:history-changed"));
  }, [loadGitState, loadTreeAndProfile, refreshProviders]);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    const commandShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (event.altKey && key === "n") {
        event.preventDefault();
        setView("chat");
        requestAnimationFrame(() => window.dispatchEvent(new Event("whim:focus-chat")));
        return;
      }
      if (key === "k") { event.preventDefault(); setPaletteOpen((value) => !value); }
      if (key === "p") {
        event.preventDefault();
        setView("build");
        requestAnimationFrame(() => window.dispatchEvent(new Event("whim:focus-files")));
      }
      if (event.shiftKey && key === "f") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
      if (key === "n") {
        event.preventDefault();
        handleNewChat();
        requestAnimationFrame(() => window.dispatchEvent(new Event("whim:focus-agent")));
      }
      if (key === "j") {
        event.preventDefault();
        updateAppSettings({ ...appSettings, general: { ...appSettings.general, showBottomPanel: !appSettings.general.showBottomPanel } });
      }
      if (key === ",") {
        event.preventDefault();
        setView("settings");
      }
    };
    window.addEventListener("keydown", commandShortcut);
    return () => window.removeEventListener("keydown", commandShortcut);
  }, [appSettings, updateAppSettings]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // Remove any stale API key that was previously persisted to localStorage
    localStorage.removeItem("whim:agent:apiKey");
    void (async () => {
      setAppSettings(await bridge.appSettings().catch(() => defaultAppSettings));
      // Provider detection (PowerShell probes for Ollama/LM Studio, environment
      // discovery) runs in parallel with workspace activation so slow or
      // unreachable provider endpoints never block file reads.
      void refreshProviders();
      if (!bridge.isNative()) return;
      const alreadySelected = await bridge.selectedWorkspace().catch(() => null);
      if (alreadySelected) { await activateWorkspace(alreadySelected).catch(() => undefined); return; }
      const recent = localStorage.getItem("whim:recent-workspace");
      if (!recent) return;
      try { await activateWorkspace(await bridge.useWorkspace(recent)); }
      catch { localStorage.removeItem("whim:recent-workspace"); }
    })();
  }, [activateWorkspace, refreshProviders]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openWorkspace = useCallback(async () => {
    try {
      const selected = await bridge.selectWorkspace();
      if (!selected) return;
      await activateWorkspace(selected);
      setView("build");
      setToast(`Opened ${selected.name}`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Could not open a folder."); }
  }, [activateWorkspace]);

  const refreshWorkspace = useCallback(async () => {
    if (!workspacePath) return;
    try {
      await loadTreeAndProfile(workspacePath);
      await loadGitState(workspacePath);
    } catch { /* errors are already displayed in the file surface */ }
  }, [loadTreeAndProfile, loadGitState, workspacePath]);

  const chooseFile = useCallback(async (path: string, line?: number) => {
    if (!workspacePath) return;
    setFileError(null);
    if (line) {
      await loadReadOnlyFile(workspacePath, path, line);
    } else {
      await loadReadOnlyFile(workspacePath, path);
    }
  }, [loadReadOnlyFile, workspacePath]);

  const closeReadOnlyFile = useCallback(() => {
    setReadOnlyFile(null);
    setActiveFile("");
    setFileError(null);
  }, []);

  const refreshCurrentProviders = refreshProviders;

  const openSidebarTask = useCallback(async (job: OrchestrationJob) => {
    try {
      if (!workspacePath || workspacePath.replace(/\\/g, "/").toLowerCase() !== job.workspace.replace(/\\/g, "/").toLowerCase()) {
        await activateWorkspace(await bridge.useWorkspace(job.workspace));
      }
      setOpenedJobId(job.id);
      setView("build");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not open this task.");
    }
  }, [activateWorkspace, workspacePath]);

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const openSidebarChat = useCallback((thread: ChatThreadSummary) => {
    setActiveThreadId(thread.id);
    setView("build");
  }, []);


  const currentFileName = activeFile ? activeFile.split(/[\\/]/).pop() : "No file";

  const workspaceGate = (title: string) => (
    <main className="hub-page" style={{ display: "grid", placeItems: "center" }}>
      <div className="palette-empty">
        <FolderOpen size={24} />
        <span><strong>{title}</strong><small>Open a project folder to use this workspace feature.</small></span>
        <button className="primary-action" type="button" onClick={openWorkspace}>Open workspace</button>
      </div>
    </main>
  );

  return (
    <div className="whim-app relative">
      {view === "settings" && (
        <SettingsLayout
          activeCategory={activeSettingsCategory}
          onCategoryChange={(category) => {
            if (category === "plugins-link") { setView("plugins"); return; }
            if (category === "connections-link") { setView("providers"); return; }
            setActiveSettingsCategory(category);
          }}
          onClose={() => setView("build")}
        >
          {activeSettingsCategory === "general" && <GeneralSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
          {activeSettingsCategory === "personalization" && <PersonalizationSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
          {activeSettingsCategory === "chat" && <ChatSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
          {activeSettingsCategory === "appearance" && <AppearanceSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
          {activeSettingsCategory === "voice" && <VoiceSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
          {activeSettingsCategory === "shortcuts" && <KeyboardShortcutsSettings />}
          {activeSettingsCategory === "configuration" && <ConfigurationSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
          {activeSettingsCategory === "computer" && <ComputerUseSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
        </SettingsLayout>
      )}
      <Titlebar projectName={projectName} native={bridge.isNative()} onCommand={() => setPaletteOpen(true)} onProjectClick={openWorkspace} />
      <div className="app-body">
        {view === "build" ? (
          <AppShell
            sidebarProps={{
              activeView: view,
              onViewChange: handleViewChange,
              workspace: workspacePath ?? "No workspace open",
              loading: treeLoading,
              branch: branch,
              onOpenWorkspace: openWorkspace,
              onRefresh: () => void refreshWorkspace(),
              onTaskSelect: (job) => void openSidebarTask(job),
              onChatSelect: openSidebarChat,
            }}
            branch={branch}
            changesCount={changes.length}
            projectName={workspacePath ? workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? undefined : undefined}
            title={chatTitle}
            onNewChat={handleNewChat}
          >
              <AgentChatView
                key={chatResetKey}
                workspace={workspacePath}
                initialThreadId={activeThreadId}
                provider={agentProvider}
                apiKey={agentApiKey}
                baseUrl={agentBaseUrl}
                model={runModel}
                onRunComplete={() => { void refreshWorkspace(); window.dispatchEvent(new Event("whim:history-changed")); }}
                onActivityChange={(running) => setActivity(running ? "agent" : "idle")}
                onOpenFile={(path) => void loadReadOnlyFile(workspacePath ?? "", path)}
                micSupported={typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia}
                onOpenProviders={() => setView("providers")}
                onTitleChange={setChatTitle}
              />
            {readOnlyFile && (
              <section className="read-only-file" aria-label="File viewer">
                <header className="read-only-file-header">
                  <span>{currentFileName}</span>
                  <button type="button" onClick={closeReadOnlyFile} aria-label="Close file">Close</button>
                </header>
                {fileLoading ? (
                  <p className="palette-empty">Reading…</p>
                ) : fileError ? (
                  <p className="file-error">{fileError}</p>
                ) : (
                  <pre className="read-only-file-content">{readOnlyFile.content}</pre>
                )}
              </section>
            )}
          </AppShell>
        ) : view !== "autopilot" && view !== "settings" ? (
          <div className="build-workspace">
            <ProjectSidebar
              activeView={view}
              onViewChange={handleViewChange}
              workspace={workspacePath ?? "No workspace open"}
              loading={treeLoading}
              branch={branch}
              onOpenWorkspace={openWorkspace}
              onRefresh={() => void refreshWorkspace()}
              onTaskSelect={(job) => void openSidebarTask(job)}
              onChatSelect={openSidebarChat}
            />
            <div className="workbench">
              <div className="workbench-main agent-first">
                <AnimatePresence mode="wait">
                <Suspense fallback={<LoadingFallback />}>
                {view === "chat" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  <ChatHub
                    workspace={workspacePath}
                    provider={agentProvider}
                    apiKey={agentApiKey}
                    baseUrl={agentBaseUrl}
                    model={runModel}
                    models={models}
                    onModelChange={onRunModelChange}
                    hasProvider={agentReady}
                    onOpenProviders={() => setView("providers")}
                    voice={appSettings.voice.voice}
                    voiceLanguage={appSettings.voice.language}
                    voiceDictionary={appSettings.voice.dictionary}
                    enterToSend={appSettings.chat.enterToSend}
                    showCopyActions={appSettings.chat.showCopyActions}
                    persistHistory={appSettings.chat.persistHistory}
                    initialThreadId={null}
                  />
                  </motion.div>
                ) : view === "browser" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  <NativeBrowserHub />
                  </motion.div>
                ) : view === "creative" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  {workspacePath ? <CreativeStudio workspace={workspacePath} onOpenConfiguration={() => { setActiveSettingsCategory("configuration"); setView("settings"); }} /> : workspaceGate("Creative Studio needs a workspace")}
                  </motion.div>
                ) : view === "providers" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  <ProviderHub onRefresh={refreshCurrentProviders}
                    agentProvider={agentProvider} agentApiKey={agentApiKey} agentBaseUrl={agentBaseUrl} agentModel={agentModel}
                    onAgentProfileChange={(patch) => {
                      if (patch.provider !== undefined) setAgentProvider(patch.provider);
                      if (patch.apiKey !== undefined) setAgentApiKey(patch.apiKey);
                      if (patch.baseUrl !== undefined) setAgentBaseUrl(patch.baseUrl);
                      if (patch.model !== undefined) setAgentModel(patch.model);
                    }}
                  />
                  </motion.div>
                ) : view === "scheduled" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  {workspacePath ? <ScheduledTasksHub workspace={workspacePath} /> : workspaceGate("Scheduled tasks need a workspace")}
                  </motion.div>
                ) : view === "plugins" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  <PluginsHub />
                  </motion.div>
                ) : view === "sites" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  {workspacePath ? <SitesHub workspace={workspacePath} /> : workspaceGate("Sites needs a workspace")}
                  </motion.div>
                ) : view === "pullRequests" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  {workspacePath ? <PullRequestsHub workspace={workspacePath} /> : workspaceGate("Pull requests need a workspace")}
                  </motion.div>
                ) : view === "ecosystem" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  {workspacePath ? <EcosystemHub workspace={workspacePath} /> : workspaceGate("Ecosystem needs a workspace")}
                  </motion.div>
                ) : view === "ship" ? (
                  <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                  {workspacePath ? <ShipHub workspace={workspacePath} /> : workspaceGate("Ship needs a workspace")}
                  </motion.div>
                ) : null}
                </Suspense>
                </AnimatePresence>
              </div>
            </div>
          </div>
        ) : (
          <Suspense fallback={<LoadingFallback />}>
          {workspacePath ? <AutopilotHub workspace={workspacePath} environment={environment} onOpenFile={chooseFile} /> : workspaceGate("Autopilot needs a workspace")}
          </Suspense>
        )}
      </div>
      {appSettings.general.showBottomPanel && <footer className="statusbar">
        <div>
          <span><GitBranch size={11} /> {branch ?? (workspace?.gitRepository ? "Git" : "No repository")}</span>
          <span><Check size={11} /> {changes.length} change{changes.length === 1 ? "" : "s"}</span>
          <span><ShieldCheck size={11} /> {currentFileName}</span>
        </div>
        <div>
          <span className="native-status"><Radio size={10} /> {bridge.isNative() ? "Windows native" : "Native app required"}</span>
          <span><CloudOff size={11} /> Local workspace</span>
          <span><Sparkles size={11} /> Whim 0.4</span>
        </div>
      </footer>}
      <CommandPalette open={paletteOpen} projectName={projectName} onClose={() => setPaletteOpen(false)} onNavigate={setView} onOpenWorkspace={openWorkspace} />
      {workspacePath && <SearchPanel workspace={workspacePath} open={searchOpen} onClose={() => setSearchOpen(false)} onOpenFile={chooseFile} />}
      {toast && <div className="toast"><span><Sparkles size={13} /></span>{toast}</div>}
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0b0d0d]">
      <div className="text-sm text-[#666]">Loading…</div>
    </div>
  );
}

export default App;

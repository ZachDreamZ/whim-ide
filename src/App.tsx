import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { MissionControl } from "./components/MissionControl";
import { OrchestrationPanel } from "./components/OrchestrationPanel";
import { ProviderHub } from "./components/ProviderHub";
import { EcosystemHub } from "./components/EcosystemHub";
import { ShipHub } from "./components/ShipHub";
import { AutopilotHub } from "./components/AutopilotHub";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsLayout } from "./components/settings/SettingsLayout";
import { GeneralSettings } from "./components/settings/pages/GeneralSettings";
import { AppearanceSettings } from "./components/settings/pages/AppearanceSettings";
import { VoiceSettings } from "./components/settings/pages/VoiceSettings";
import { ComputerUseSettings } from "./components/settings/pages/ComputerUseSettings";
import {
  bridge,
  defaultAppSettings,
  type AppSettings,
  type CredentialReport,
  type EnvironmentReport,
  type LocalProviderStatus,
  type WorkspaceInfo,
} from "./lib/bridge";
import { chooseInitialFile, inspectProject, parseGitState, type ProjectProfile } from "./lib/project";
import type { WorkspaceEntry, WorkbenchFileChange } from "./types/workbench";

const defaultEnvironment: EnvironmentReport = { platform: "Windows", tools: [] };
const defaultCredentials: CredentialReport = { environmentNames: [], envFiles: [] };
const defaultProfile: ProjectProfile = { framework: null, packageManager: null, checkCommand: null, devCommand: null };

type ReadOnlyFile = { path: string; content: string };

function App() {
  const [view, setView] = useState<ViewId>("build");
  const [activeSettingsCategory, setActiveSettingsCategory] = useState("general");
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState("");
  const [readOnlyFile, setReadOnlyFile] = useState<ReadOnlyFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [models] = useState<string[]>([]);
  const [agentProvider, setAgentProvider] = useState(() => localStorage.getItem("whim:agent:provider") ?? "auto");
  const [agentApiKey, setAgentApiKey] = useState("");
  const [agentBaseUrl, setAgentBaseUrl] = useState(() => localStorage.getItem("whim:agent:baseUrl") ?? "");
  const [agentModel, setAgentModel] = useState(() => localStorage.getItem("whim:agent:model") ?? "");
  const [environment, setEnvironment] = useState<EnvironmentReport>(defaultEnvironment);
  const [credentials, setCredentials] = useState<CredentialReport>(defaultCredentials);
  const [localProviders, setLocalProviders] = useState<LocalProviderStatus[]>([]);
  const [profile, setProfile] = useState<ProjectProfile>(defaultProfile);
  const [branch, setBranch] = useState<string | null>(null);
  const [changes, setChanges] = useState<WorkbenchFileChange[]>([]);
  const [, setActivity] = useState<"idle" | "agent" | "checking" | "deploying">("idle");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const booted = useRef(false);
  const fileRequest = useRef(0);
  const settingsRevision = useRef(0);
  const settingsSaveChain = useRef<Promise<unknown>>(Promise.resolve());

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
  }, [appSettings.appearance]);

  const workspacePath = workspace?.path ?? null;
  const projectName = workspace?.name ?? "No workspace";

  const runModel = agentModel;
  const onRunModelChange = setAgentModel;
  const agentReady = agentProvider === "auto" || agentProvider === "local" || agentProvider === "omniroute" || agentApiKey.trim().length > 0;

  const refreshProviders = useCallback(async (_root?: string | null, _refreshCatalog = false) => {
    const [environmentResult, credentialsResult, localResult] = await Promise.allSettled([
      bridge.environment(), bridge.credentials(), bridge.localProviders(),
    ]);
    if (environmentResult.status === "fulfilled") setEnvironment(environmentResult.value);
    if (credentialsResult.status === "fulfilled") setCredentials(credentialsResult.value);
    if (localResult.status === "fulfilled") setLocalProviders(localResult.value);
  }, []);

  const loadReadOnlyFile = useCallback(async (root: string, path: string) => {
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
      setReadOnlyFile({ path, content });
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
    const nextEntries = await loadTreeAndProfile(info.path);
    void loadGitState(info.path);
    void refreshProviders(info.path);
    const recentFile = localStorage.getItem(`whim:last-file:${info.path}`);
    const initial = recentFile && nextEntries.some((entry) => entry.kind === "file" && entry.path.replace(/\\/g, "/") === recentFile.replace(/\\/g, "/")) ? recentFile : chooseInitialFile(nextEntries);
    if (initial) await loadReadOnlyFile(info.path, initial);
  }, [loadReadOnlyFile, loadGitState, loadTreeAndProfile, refreshProviders]);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    const commandShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((value) => !value); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setView("build");
        requestAnimationFrame(() => window.dispatchEvent(new Event("whim:focus-files")));
      }
    };
    window.addEventListener("keydown", commandShortcut);
    return () => window.removeEventListener("keydown", commandShortcut);
  }, []);

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
      void refreshProviders(null);
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

  const chooseFile = useCallback(async (path: string) => {
    if (!workspacePath) return;
    setFileError(null);
    await loadReadOnlyFile(workspacePath, path);
  }, [loadReadOnlyFile, workspacePath]);

  const closeReadOnlyFile = useCallback(() => {
    setReadOnlyFile(null);
    setActiveFile("");
    setFileError(null);
  }, []);

  const refreshCurrentProviders = useCallback(
    () => refreshProviders(workspacePath, true),
    [refreshProviders, workspacePath],
  );


  const contextItems = useMemo(() => [
    ...(profile.framework ? [{ id: "framework", label: profile.framework, tone: "violet" as const }] : []),
    ...(profile.packageManager ? [{ id: "packages", label: profile.packageManager, tone: "mint" as const }] : []),
    ...(models.length ? [{ id: "models", label: `${models.length} connected models`, tone: "coral" as const }] : []),
  ], [models.length, profile.framework, profile.packageManager]);
  const readme = entries.find((entry) => entry.kind === "file" && /(^|\/)readme\.md$/i.test(entry.path));
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
          onCategoryChange={setActiveSettingsCategory}
          onClose={() => setView("build")}
        >
          {activeSettingsCategory === "general" && <GeneralSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
          {activeSettingsCategory === "appearance" && <AppearanceSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
          {activeSettingsCategory === "voice" && <VoiceSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
          {activeSettingsCategory === "computer" && <ComputerUseSettings settings={appSettings} onChange={updateAppSettings} saving={settingsSaving} />}
        </SettingsLayout>
      )}
      <Titlebar projectName={projectName} native={bridge.isNative()} onCommand={() => setPaletteOpen(true)} onProjectClick={openWorkspace} />
      <div className="app-body">
        {view === "build" || view === "providers" || view === "ecosystem" || view === "orchestrate" || view === "ship" ? (
          <div className="build-workspace">
            <ProjectSidebar
              activeView={view}
              onViewChange={setView}
              workspace={workspacePath ?? "No workspace open"}
              activeFile={activeFile}
              entries={entries}
              loading={treeLoading}
              error={treeError}
              branch={branch}
              livingBrief={readme ? { eyebrow: "Project guide", title: readme.path } : null}
              contextItems={contextItems}
              filterShortcut="Ctrl P"
              onFileSelect={chooseFile}
              onOpenWorkspace={openWorkspace}
              onRefresh={() => void refreshWorkspace()}
              onOpenActions={workspacePath ? () => void bridge.reveal(workspacePath) : undefined}
              onOpenBrief={readme ? () => void chooseFile(readme.path) : undefined}
            />
            <div className="workbench">
              <div className="workbench-main agent-first">
                {view === "build" ? (
                  <MissionControl
                    workspace={workspacePath}
                    workspaceEntries={entries}
                    model={runModel}
                    models={models}
                    onModelChange={onRunModelChange}
                    hasProvider={agentReady}
                    onOpenProviders={() => setView("providers")}
                    provider={agentProvider}
                    apiKey={agentApiKey}
                    baseUrl={agentBaseUrl}
                    voice={appSettings.voice.voice}
                    voiceLanguage={appSettings.voice.language}
                    showSuggestedPrompts={appSettings.general.suggestedPrompts}
                    onRunComplete={() => void refreshWorkspace()}
                    onActivityChange={(running) => setActivity(running ? "agent" : "idle")}
                  />
                ) : view === "providers" ? (
                  <ProviderHub workspace={workspacePath} credentials={credentials} localProviders={localProviders} onRefresh={refreshCurrentProviders}
                    agentProvider={agentProvider} agentApiKey={agentApiKey} agentBaseUrl={agentBaseUrl} agentModel={agentModel}
                    onAgentProfileChange={(patch) => {
                      if (patch.provider !== undefined) setAgentProvider(patch.provider);
                      if (patch.apiKey !== undefined) setAgentApiKey(patch.apiKey);
                      if (patch.baseUrl !== undefined) setAgentBaseUrl(patch.baseUrl);
                      if (patch.model !== undefined) setAgentModel(patch.model);
                    }}
                  />
                ) : view === "ecosystem" ? (
                  workspacePath ? <EcosystemHub workspace={workspacePath} /> : workspaceGate("Ecosystem needs a workspace")
                ) : view === "orchestrate" ? (
                  workspacePath ? <OrchestrationPanel workspace={workspacePath} /> : workspaceGate("Orchestrate needs a workspace")
                ) : view === "ship" ? (
                  workspacePath ? <ShipHub workspace={workspacePath} /> : workspaceGate("Ship needs a workspace")
                ) : null}
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
              </div>
            </div>
          </div>
        ) : (
          workspacePath ? <AutopilotHub workspace={workspacePath} environment={environment} onOpenFile={chooseFile} /> : workspaceGate("Autopilot needs a workspace")
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
      {toast && <div className="toast"><span><Sparkles size={13} /></span>{toast}</div>}
    </div>
  );
}

export default App;

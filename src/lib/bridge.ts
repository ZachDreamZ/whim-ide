import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath as openNativePath, openUrl as openNativeUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

export type WhimErrorShape = { code?: string; message: string };

/**
 * Parse a structured backend error. The Rust bridge emits
 * `WHIM:<CODE>|<human detail>` envelopes (see `whim_err` in backend.rs)
 * so the frontend branches on a stable code instead of matching free-form
 * message text. Non-enveloped errors fall back to their raw message.
 */
export function whimError(error: unknown): WhimErrorShape {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const match = /^WHIM:([A-Z0-9_]+)\|(.*)$/s.exec(raw.trim());
  if (match) {
    return { code: match[1], message: match[2].trim() || raw };
  }
  const legacy = /^WHIM_ERROR:\s*([A-Z0-9_]+)\s*-\s*(.*)$/s.exec(raw.trim());
  if (legacy) {
    return { code: legacy[1], message: legacy[2].trim() || raw };
  }
  return { message: raw };
}

/** Clean, display-ready message (envelope prefix stripped if present). */
export function errorMessage(error: unknown): string {
  return whimError(error).message;
}

export type ToolchainItem = {
  id: string;
  name: string;
  installed: boolean;
  version?: string | null;
  path?: string | null;
};

export type EnvironmentReport = {
  platform: string;
  hostname?: string;
  tools: ToolchainItem[];
};

export type CredentialReport = {
  environmentNames: string[];
  envFiles: { path: string; names: string[] }[];
};

export type WorkspaceInfo = {
  path: string;
  name: string;
  gitRepository: boolean;
};

export type Observation = {
  id: string;
  timestamp: number;
  content: string;
  importanceScore: number;
  merged: boolean;
};

export type ScheduleRecurrence = "once" | "daily" | "weekdays" | "weekly";

export type ScheduledTask = {
  id: string;
  title: string;
  prompt: string;
  recurrence: ScheduleRecurrence;
  nextRunAtMs: number;
  enabled: boolean;
  mode: OrchestrationJobMode;
  provider?: string | null;
  model?: string | null;
  createdAtMs: number;
  lastRunAtMs?: number | null;
  lastJobId?: string | null;
};

export type CodexPlugin = {
  pluginId: string;
  id: string;
  marketplaceName: string;
  installed: boolean;
  enabled: boolean;
  displayName: string;
  description: string;
  version: string;
  developerName: string;
  category?: string | null;
  capabilities: string[];
  brandColor?: string | null;
  websiteUrl?: string | null;
  manifestPath: string;
};

export type CodexPluginCatalog = { installed: CodexPlugin[]; available: CodexPlugin[] };

export type SitesStatus = {
  pluginInstalled: boolean;
  pluginVersion?: string | null;
  configExists: boolean;
  configPath: string;
  projectId?: string | null;
  siteSlug?: string | null;
  access?: string | null;
  buildCommand?: string | null;
  outputDirectory?: string | null;
  rawConfig?: Record<string, unknown> | null;
};

export type PullRequestItem = {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  headRefName: string;
  baseRefName: string;
  author?: string | null;
  updatedAt?: string | null;
  repository: string;
  relationship: "authored" | "reviewing" | "reviewed";
};

export type PullRequestStatus = {
  isRepository: boolean;
  branch?: string | null;
  remoteUrl?: string | null;
  githubAuthenticated: boolean;
  accountLogin?: string | null;
  pullRequests: PullRequestItem[];
  previouslyReviewed: PullRequestItem[];
  message?: string | null;
};

export type AppContextResult = { source: "vscode" | "terminal" | "screenshot"; available: boolean; message: string; content?: string | null; path?: string | null; contentKind?: "text" | "image" };

export type ChatThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAtMs: number;
};

export type ChatThread = {
  id: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  model?: string | null;
  messages: ChatThreadMessage[];
};

export type ChatThreadSummary = {
  id: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  messageCount: number;
  preview: string;
};

export type AppSettings = {
  version: number;
  general: {
    showBottomPanel: boolean;
    suggestedPrompts: boolean;
  };
  personalization: {
    enabled: boolean;
    customInstructions: string;
    responseStyle: "normal" | "concise" | "formal" | "explanatory";
    projectMemory: boolean;
  };
  chat: {
    enterToSend: boolean;
    showCopyActions: boolean;
    persistHistory: boolean;
  };
  appearance: {
    accent: string;
    uiFont: string;
    codeFont: string;
    contrast: number;
    reduceMotion: "system" | "on" | "off";
    pointerCursors: boolean;
    uiFontSize: number;
    codeFontSize: number;
  };
  voice: {
    voice: "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer" | "verse";
    language: "auto" | "en" | "es" | "fr" | "de" | "ja" | "zh";
    dictionary: string;
  };
  computerUse: { enabled: boolean; screenCapture: boolean; appContext: boolean };
  agent: {
    runtime: "native" | "pi" | "codex" | "claude" | "antigravity" | "eve";
    piModel: string;
    externalModel: string;
    speed: "fast" | "balanced" | "thorough";
    approvalPolicy: "always" | "risky";
    backgroundVerification: boolean;
    autonomousJanitor: boolean;
    deferCapabilities: boolean;
    maxParallelAgents: number;
    enabledCapabilities: string[];
    defaultAdapter: string;
    wslDistro: string;
    containerImage: string;
    remoteHost: string;
  };
};

export type AgentCapability = {
  id: string;
  description: string;
  instructions: string;
  tools: string[];
  deferLoading: boolean;
  enabled: boolean;
};

export const defaultAppSettings: AppSettings = {
  version: 1,
  general: { showBottomPanel: true, suggestedPrompts: true },
  personalization: { enabled: true, customInstructions: "", responseStyle: "normal", projectMemory: true },
  chat: { enterToSend: true, showCopyActions: true, persistHistory: true },
  appearance: { accent: "#72c99f", uiFont: "IBM Plex Sans Variable", codeFont: "JetBrains Mono Variable", contrast: 60, reduceMotion: "system", pointerCursors: true, uiFontSize: 14, codeFontSize: 13 },
  voice: { voice: "alloy", language: "auto", dictionary: "" },
  computerUse: { enabled: false, screenCapture: true, appContext: true },
  agent: {
    runtime: "native",
    piModel: "opencode/big-pickle",
    externalModel: "default",
    speed: "balanced",
    approvalPolicy: "risky",
    backgroundVerification: true,
    autonomousJanitor: true,
    deferCapabilities: true,
    maxParallelAgents: 4,
    enabledCapabilities: ["workspace", "research", "coding", "verification", "pi-delegation", "external-harnesses"],
    defaultAdapter: "native",
    wslDistro: "Ubuntu",
    containerImage: "ubuntu:latest",
    remoteHost: "user@localhost",
  },
};

/** A Git-reported execution folder. `managed` means Whim created it under
 * the repository's `.whim-worktrees` sibling directory. */
export type GitWorktree = {
  path: string;
  branch?: string | null;
  head?: string | null;
  detached: boolean;
  primary: boolean;
  managed: boolean;
};

export type CandidateChange = {
  path: string;
  status: string;
  source: "committed" | "working";
};

export type WorktreeCandidateReport = {
  baseWorkspace: string;
  candidateWorkspace: string;
  baseHead: string;
  candidateHead: string;
  mergeBase: string;
  branch?: string | null;
  committedChangeCount: number;
  workingChangeCount: number;
  changes: CandidateChange[];
  changesTruncated: boolean;
  risk: "low" | "medium" | "high";
  riskSignals: string[];
  blockers: string[];
  verificationChecks: VerificationCheck[];
  verificationWarnings: string[];
};

export type VerificationCheck = {
  id: string;
  label: string;
  command: string;
  source: string;
  tier: "core" | "extended";
  timeoutMs: number;
};

export type VerificationPlan = {
  workspace: string;
  checks: VerificationCheck[];
  warnings: string[];
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  modifiedMs?: number | null;
};
export type WorkspaceFileContent = { path: string; content: string; size: number; modifiedMs?: number | null };
export type WorkspaceFileWrite = { path: string; bytesWritten: number; created: boolean; modifiedMs?: number | null };

export type NativeResult = {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  sessionId?: string | null;
  operationId?: string;
  durationMs?: number;
  message?: string;
  cancelled?: boolean;
  timedOut?: boolean;
  events?: unknown[];
};

export type OrchestrationJobMode =
  | "auto"
  | "vibe"
  | "plan"
  | "research"
  | "build"
  | "verify"
  | "review"
  | "ship"
  | "operate";

export type OrchestrationJobRisk = "low" | "medium" | "high";

export type OrchestrationJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "interrupted"
  | "completed"
  | "failed"
  | "cancelled";

export type OrchestrationJobAction = "start" | "pause" | "resume" | "cancel";

export type OrchestrationJobOutcome = "completed" | "failed" | "cancelled";

export type OrchestrationJobEvidence = {
  eventCount: number;
  toolCallCount: number;
  failedToolCallCount: number;
  durationMs?: number | null;
  timedOut: boolean;
};

export type OrchestrationJob = {
  id: string;
  workspace: string;
  title: string;
  intent: string;
  mode: OrchestrationJobMode;
  risk: OrchestrationJobRisk;
  status: OrchestrationJobStatus;
  budget: { maxDurationMs: number; maxToolIterations: number; maxAttempts: number };
  operationId?: string | null;
  operationIds: string[];
  provider?: string | null;
  model?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs?: number | null;
  finishedAtMs?: number | null;
  summary?: string | null;
  evidence: OrchestrationJobEvidence;
  eventCount: number;
  attempt: number;
  nextEligibleAtMs?: number | null;
};

export type OrchestrationJobEvent = {
  id: string;
  atMs: number;
  actor: "user" | "agent" | "system";
  kind:
    | "created"
    | "started"
    | "paused"
    | "resumed"
    | "interrupted"
    | "cancelled"
    | "evidence"
    | "completed"
    | "failed"
    | "retryScheduled";
  message: string;
  evidence?: OrchestrationJobEvidence | null;
};

export type OrchestrationJobDetail = {
  job: OrchestrationJob;
  events: OrchestrationJobEvent[];
};

export type ProviderStatus = {
  id: string;
  authenticated: boolean;
  authType?: string | null;
  authSources: string[];
  credentialNames: string[];
  modelCount: number;
  catalogAvailable: boolean;
};

export type DiscoveredProvider = {
  provider: string;
  label: string;
  kind: "local" | "gateway" | "cloud";
  available: boolean;
  hasKey: boolean;
  baseUrl: string | null;
  note: string | null;
  capabilities: { chat: boolean; speechToText: boolean; textToSpeech: boolean };
};

export type ProviderInventory = {
  available: boolean;
  version?: string | null;
  providers: ProviderStatus[];
};

export type LocalProviderStatus = {
  id: "ollama" | "lmstudio" | "omniroute";
  name: string;
  detected: boolean;
  reachable: boolean;
  endpoint: string;
  cliPath?: string | null;
  models: { id: string; name: string }[];
  detail: string;
};

export type ExternalHarnessStatus = {
  id: "codex" | "claude" | "antigravity" | "eve" | "pi" | "opencode";
  name: string;
  available: boolean;
  authenticated: boolean;
  authKind: string;
  version?: string | null;
  path?: string | null;
  capabilities: string[];
  setupHint: string;
};

export type EveProjectStatus = {
  detected: boolean;
  layout?: string | null;
  packageVersion?: string | null;
  cliAvailable: boolean;
  cliPath?: string | null;
  instructionsPath?: string | null;
  skills: string[];
  tools: string[];
  channels: string[];
  schedules: string[];
  evals: string[];
  compileStatus?: string | null;
  model?: string | null;
  diagnosticErrors?: number | null;
  diagnosticWarnings?: number | null;
  createRoute?: string | null;
  continueRoute?: string | null;
  streamRoute?: string | null;
};

export type MediaRuntimeStatus = {
  codexAvailable: boolean;
  codexAuthenticated: boolean;
  codexAuthKind: string;
  ffmpegAvailable: boolean;
  windowsVoiceAvailable: boolean;
};

export type MediaArtifact = {
  kind: "image" | "video" | "audio" | "captions";
  path: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
};

export type MediaGenerateResult = {
  id: string;
  mode: "image" | "ugc-video";
  title: string;
  summary: string;
  outputDirectory: string;
  artifacts: MediaArtifact[];
};

export type MediaProgressEvent = { operationId: string; stage: string; message: string };

export type WorkflowSummary = {
  id: string;
  title: string;
  description: string;
  source: string;
};

type BackendTool = { name: string; available: boolean; version?: string | null; path?: string | null };
type BackendEnvironment = {
  os: string;
  arch: string;
  windowsVersion?: string | null;
  tools: BackendTool[];
};
type BackendCredentials = {
  entries: { provider: string; name: string; source: string }[];
  scannedSources: string[];
};
type BackendCommand = {
  operationId: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  durationMs?: number;
  cancelled?: boolean;
  timedOut?: boolean;
  command?: string;
};

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function requireNative(): never {
  throw new Error("This action is available in the installed Whim Windows app.");
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri()) requireNative();
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    // Convert structured `WHIM:CODE|detail` envelopes into clean Errors that
    // keep the human message for toasts while exposing `.code` for branching.
    // Non-enveloped errors (e.g. SyntaxError from JSON.parse) pass through
    // unchanged so existing type checks keep working.
    const parsed = whimError(error);
    if (parsed.code) {
      const cleaned = new Error(parsed.message);
      (cleaned as unknown as { code?: string }).code = parsed.code;
      throw cleaned;
    }
    throw error;
  }
}

function fromCommand(command: BackendCommand): NativeResult {
  return {
    success: command.success,
    stdout: command.stdout,
    stderr: command.stderr,
    exitCode: command.exitCode,
    operationId: command.operationId,
    durationMs: command.durationMs,
    cancelled: command.cancelled,
    timedOut: command.timedOut,
  };
}

export const bridge = {
  isNative: inTauri,

  async appSettings(): Promise<AppSettings> {
    if (!inTauri()) return structuredClone(defaultAppSettings);
    return call<AppSettings>("get_app_settings");
  },

  async saveAppSettings(settings: AppSettings): Promise<AppSettings> {
    return call<AppSettings>("save_app_settings", { settings });
  },

  async agentCapabilities(mode = "auto"): Promise<AgentCapability[]> {
    if (!inTauri()) return [];
    return call<AgentCapability[]>("list_agent_capabilities", { mode });
  },

  async environment(): Promise<EnvironmentReport> {
    if (!inTauri()) return { platform: "Browser preview (native features unavailable)", tools: [] };
    const report = await call<BackendEnvironment>("discover_environment");
    return {
      platform: report.windowsVersion || `${report.os} ${report.arch}`,
      tools: report.tools.map((tool) => ({
        id: tool.name,
        name: tool.name === "wt" ? "Windows Terminal" : tool.name === "node" ? "Node.js" : tool.name,
        installed: tool.available,
        version: tool.version,
        path: tool.path,
      })),
    };
  },

  async listProviderModels(provider: string, apiKey: string, baseUrl: string): Promise<string[]> {
    if (!inTauri()) return [];
    return call<string[]>("list_provider_models", { provider, apiKey, baseUrl });
  },

  async credentials(): Promise<CredentialReport> {
    if (!inTauri()) return { environmentNames: [], envFiles: [] };
    const report = await call<BackendCredentials>("discover_credential_names");
    const envFiles = new Map<string, string[]>();
    for (const entry of report.entries) {
      if (!entry.source.startsWith("workspace:")) continue;
      const path = entry.source.slice("workspace:".length);
      envFiles.set(path, [...(envFiles.get(path) ?? []), entry.name]);
    }
    return {
      environmentNames: report.entries.filter((entry) => entry.source === "processEnvironment").map((entry) => entry.name),
      envFiles: [...envFiles].map(([path, names]) => ({ path, names })),
    };
  },

  async selectedWorkspace(): Promise<WorkspaceInfo | null> {
    if (!inTauri()) return null;
    return call<WorkspaceInfo | null>("get_selected_workspace");
  },

  async useWorkspace(path: string): Promise<WorkspaceInfo> {
    return call<WorkspaceInfo>("select_workspace", {
      request: { candidateWorkspace: path },
    });
  },

  async listGitWorktrees(): Promise<GitWorktree[]> {
    if (!inTauri()) return [];
    return call<GitWorktree[]>("list_git_worktrees");
  },

  async createGitWorktree(input: {
    name: string;
    baseRef?: string;
    operationId?: string;
  }): Promise<GitWorktree> {
    return call<GitWorktree>("create_git_worktree", {
      request: input,
    });
  },

  async inspectWorktreeCandidate(candidateWorkspace: string): Promise<WorktreeCandidateReport> {
    return call<WorktreeCandidateReport>("inspect_worktree_candidate", {
      request: { candidateWorkspace },
    });
  },

  async verificationPlan(workspace: string): Promise<VerificationPlan> {
    if (!inTauri()) return { workspace, checks: [], warnings: ["Verification discovery is available in the installed Windows app."] };
    return call<VerificationPlan>("discover_verification_plan", { workspace });
  },

  async selectWorkspace(): Promise<WorkspaceInfo | null> {
    if (!inTauri()) requireNative();
    const selected = await open({ directory: true, multiple: false, title: "Open a project in Whim" });
    if (!selected || Array.isArray(selected)) return null;
    return bridge.useWorkspace(selected);
  },

  async listWorkspace(workspace?: string): Promise<WorkspaceEntry[]> {
    const listing = await call<{ entries: WorkspaceEntry[] }>("list_workspace_tree", {
      workspace,
      request: { path: "", includeHidden: false, maxDepth: 8, maxEntries: 5000 },
    });
    return listing.entries;
  },

  async readFile(workspace: string, path: string): Promise<string> {
    const result = await bridge.readFileContent(workspace, path);
    return result.content;
  },

  async readFileContent(workspace: string, path: string): Promise<WorkspaceFileContent> {
    return call<WorkspaceFileContent>("read_workspace_file", { workspace, request: { path, maxBytes: 8_000_000 } });
  },

  async writeFile(workspace: string, path: string, content: string, createParents = false, expectedModifiedMs?: number | null): Promise<WorkspaceFileWrite> {
    return call<WorkspaceFileWrite>("write_workspace_file", { workspace, request: { path, content, createParents, overwrite: true, expectedModifiedMs } });
  },

  async captureAppContext(source: AppContextResult["source"]): Promise<AppContextResult> {
    if (!inTauri()) return { source, available: false, message: "Desktop context is available in the installed Windows app." };
    return call<AppContextResult>("capture_app_context", { request: { source } });
  },

  async transcribeVoice(input: { audio: number[]; mimeType: string; provider?: string; apiKey?: string; baseUrl?: string; model?: string; language?: string; prompt?: string }): Promise<string> {
    const result = await call<{ text: string }>("transcribe_voice", { request: input }); return result.text;
  },

  async synthesizeVoice(input: { text: string; provider?: string; apiKey?: string; baseUrl?: string; model?: string; voice?: string }): Promise<number[]> {
    return call<number[]>("synthesize_voice", { request: input });
  },

  async runCommand(workspace: string, command: string, options?: { operationId?: string; timeoutMs?: number; confirmed?: boolean }): Promise<NativeResult> {
    const result = await call<BackendCommand>("run_powershell_command", {
      workspace,
      request: {
        command,
        confirmed: options?.confirmed ?? true,
        timeoutMs: options?.timeoutMs ?? 180_000,
        operationId: options?.operationId,
      },
    });
    return fromCommand(result);
  },

  async cancelOperation(operationId: string): Promise<boolean> {
    const result = await call<{ found: boolean; terminationRequested: boolean }>("cancel_operation", { operationId });
    return result.found && result.terminationRequested;
  },

  async localProviders(): Promise<LocalProviderStatus[]> {
    if (!inTauri()) return [];
    const result = await call<{ providers: LocalProviderStatus[] }>("discover_local_ai_providers", {
      request: { timeoutMs: 5_000 },
    });
    return result.providers;
  },

  async externalHarnesses(): Promise<ExternalHarnessStatus[]> {
    if (!inTauri()) return [];
    return call<ExternalHarnessStatus[]>("discover_external_harnesses");
  },

  async inspectEveWorkspace(workspace: string): Promise<EveProjectStatus> {
    return call<EveProjectStatus>("inspect_eve_workspace", { workspace });
  },

  async validateEveWorkspace(workspace: string): Promise<EveProjectStatus> {
    return call<EveProjectStatus>("validate_eve_workspace", {
      request: { workspace, confirmed: true },
    });
  },

  async mediaRuntimeStatus(): Promise<MediaRuntimeStatus> {
    if (!inTauri()) return { codexAvailable: false, codexAuthenticated: false, codexAuthKind: "unavailable", ffmpegAvailable: false, windowsVoiceAvailable: false };
    return call<MediaRuntimeStatus>("media_runtime_status");
  },

  async generateMedia(input: {
    workspace: string;
    operationId: string;
    mode: "image" | "ugc-video";
    prompt: string;
    title?: string;
    aspectRatio?: "1:1" | "16:9" | "9:16";
    durationSeconds?: number;
    onEvent?: (event: MediaProgressEvent) => void;
  }): Promise<MediaGenerateResult> {
    let unlisten: (() => void) | undefined;
    if (inTauri() && input.onEvent) {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<MediaProgressEvent>("whim:media-event", ({ payload }) => {
        if (payload.operationId === input.operationId) input.onEvent?.(payload);
      });
    }
    try {
      return await call<MediaGenerateResult>("generate_media", {
        request: {
          workspace: input.workspace,
          operationId: input.operationId,
          mode: input.mode,
          prompt: input.prompt,
          title: input.title,
          aspectRatio: input.aspectRatio,
          durationSeconds: input.durationSeconds,
        },
      });
    } finally {
      unlisten?.();
    }
  },

  async readMediaArtifact(workspace: string, path: string): Promise<Uint8Array> {
    const bytes = await call<number[]>("read_media_artifact", { workspace, path });
    return Uint8Array.from(bytes);
  },

  async workspaceWorkflows(workspace: string): Promise<WorkflowSummary[]> {
    if (!inTauri()) return [];
    return call<WorkflowSummary[]>("list_workspace_workflows", { workspace });
  },

  async expandWorkspaceWorkflow(workspace: string, prompt: string): Promise<string> {
    if (!inTauri()) return prompt;
    return call<string>("expand_workspace_workflow", { workspace, prompt });
  },

  async runAgent(input: {
    workspace?: string;
    prompt: string;
    model?: string;
    agent?: string;
    sessionId?: string;
    operationId: string;
    autoApprove?: boolean;
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    autoContinue?: boolean;
    timeoutMs?: number;
    /** Receives real native agent events while the invoke call is in flight. */
    onEvent?: (event: unknown) => void;
  }): Promise<NativeResult> {
    let unlisten: (() => void) | undefined;
    if (inTauri() && input.onEvent) {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ operationId?: string; event?: unknown }>("whim:agent-event", ({ payload }) => {
          if (payload && payload.operationId === input.operationId) input.onEvent?.(payload.event);
        });
      } catch {
        // Event wiring is an enhancement. The native invoke result still
        // contains the complete event history and remains authoritative.
      }
    }
    try {
      const result = await call<{
        events: unknown[];
        command: BackendCommand;
        sessionId?: string | null;
        modelId?: string | null;
      }>("run_agent_prompt", {
        request: {
          workspace: input.workspace,
          prompt: input.prompt,
          model: input.model,
          agent: input.agent,
          sessionId: input.sessionId,
          operationId: input.operationId,
          timeoutMs: input.timeoutMs ?? 600_000,
          autoApprove: input.autoApprove ?? false,
          autoApproveConfirmed: false,
          provider: input.provider,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          autoContinue: input.autoContinue ?? true,
        },
      });
      return {
        ...fromCommand(result.command),
        sessionId: result.sessionId ?? findSessionId(result.events),
        events: result.events,
        stdout: result.events.length ? result.events.map((event) => JSON.stringify(event)).join("\n") : result.command.stdout,
      };
    } finally {
      unlisten?.();
    }
  },

  async recordVerificationResult(input: {
    workspace?: string;
    jobId: string;
    checkId: string;
    command: string;
    success: boolean;
    durationMs?: number;
  }): Promise<OrchestrationJob> {
    return call<OrchestrationJob>("record_verification_result", {
      request: input,
    });
  },

  async createOrchestrationJob(input: {

    workspace: string;
    intent: string;
    title?: string;
    mode: OrchestrationJobMode;
    operationId?: string;
    provider?: string;
    model?: string;
    maxDurationMs?: number;
  }): Promise<OrchestrationJob> {
    return call<OrchestrationJob>("create_orchestration_job", {
      request: input,
    });
  },

  async listOrchestrationJobs(workspace: string): Promise<OrchestrationJob[]> {
    return call<OrchestrationJob[]>("list_orchestration_jobs", {
      request: { workspace },
    });
  },

  async listProjectOrchestrationJobs(): Promise<OrchestrationJob[]> {
    return call<OrchestrationJob[]>("list_project_orchestration_jobs");
  },

  async listScheduledTasks(workspace: string): Promise<ScheduledTask[]> {
    return call<ScheduledTask[]>("list_scheduled_tasks", { workspace });
  },

  async saveScheduledTask(input: {
    workspace: string;
    id?: string;
    title: string;
    prompt: string;
    recurrence: ScheduleRecurrence;
    nextRunAtMs: number;
    enabled?: boolean;
    mode?: OrchestrationJobMode;
    provider?: string;
    model?: string;
  }): Promise<ScheduledTask> {
    return call<ScheduledTask>("save_scheduled_task", { request: input });
  },

  async deleteScheduledTask(workspace: string, scheduleId: string): Promise<void> {
    return call<void>("delete_scheduled_task", { request: { workspace, scheduleId } });
  },

  async toggleScheduledTask(workspace: string, scheduleId: string, enabled: boolean): Promise<ScheduledTask> {
    return call<ScheduledTask>("toggle_scheduled_task", { request: { workspace, scheduleId, enabled } });
  },

  async claimDueScheduledTasks(workspace: string): Promise<ScheduledTask[]> {
    return call<ScheduledTask[]>("claim_due_scheduled_tasks", { workspace });
  },

  async markScheduledTaskRun(workspace: string, scheduleId: string, jobId: string): Promise<void> {
    return call<void>("mark_scheduled_task_run", { request: { workspace, scheduleId, jobId } });
  },

  async codexPlugins(): Promise<CodexPlugin[]> {
    return call<CodexPlugin[]>("list_codex_plugins");
  },

  async codexPluginCatalog(): Promise<CodexPluginCatalog> {
    return call<CodexPluginCatalog>("list_codex_plugin_catalog");
  },

  async installCodexPlugin(pluginId: string): Promise<void> {
    return call<void>("install_codex_plugin", { pluginId });
  },

  async removeCodexPlugin(pluginId: string): Promise<void> {
    return call<void>("remove_codex_plugin", { pluginId });
  },

  async sitesStatus(workspace: string): Promise<SitesStatus> {
    return call<SitesStatus>("inspect_sites_workspace", { workspace });
  },

  async pullRequestStatus(workspace: string): Promise<PullRequestStatus> {
    return call<PullRequestStatus>("inspect_pull_requests", { workspace });
  },

  async getOrchestrationJob(workspace: string, jobId: string): Promise<OrchestrationJobDetail> {
    return call<OrchestrationJobDetail>("get_orchestration_job", {
      request: { workspace, jobId },
    });
  },

  async getObservationalMemory(workspacePath: string): Promise<Observation[]> {
    return call<Observation[]>("get_observational_memory", {
      workspacePath,
    });
  },

  async transitionOrchestrationJob(
    workspace: string,
    jobId: string,
    action: OrchestrationJobAction,
  ): Promise<OrchestrationJob> {
    return call<OrchestrationJob>("transition_orchestration_job", {
      request: { workspace, jobId, action },
    });
  },

  async finishOrchestrationJob(input: {
    workspace: string;
    jobId: string;
    outcome: OrchestrationJobOutcome;
    summary?: string;
    evidence: OrchestrationJobEvidence;
  }): Promise<OrchestrationJob> {
    return call<OrchestrationJob>("finish_orchestration_job", {
      request: input,
    });
  },

  async retryOrchestrationJob(input: {
    workspace: string;
    jobId: string;
    operationId: string;
    delayMs?: number;
  }): Promise<OrchestrationJob> {
    return call<OrchestrationJob>("retry_orchestration_job", {
      request: input,
    });
  },

  async dispatchOrchestrationJob(input: {
    workspace: string;
    jobId: string;
    apiKey?: string;
    baseUrl?: string;
  }): Promise<OrchestrationJob> {
    return call<OrchestrationJob>("dispatch_orchestration_job", {
      request: input,
    });
  },

  async deployPreflight(workspace: string, target: string): Promise<NativeResult> {
    const mode = target === "docker" ? "local" : target === "render" || target === "fly" ? "production" : "preview";
    const result = await call<{
      ready: boolean;
      warnings: string[];
      plannedCommand?: string | null;
      projectSignals: string[];
      supportsPreview?: boolean;
    }>("deploy_preflight", { workspace, request: { target, mode, options: null } });
    return {
      success: result.ready,
      stdout: [
        result.plannedCommand ? `Command: ${result.plannedCommand}` : "Deployment command resolved",
        ...result.projectSignals.map((signal) => `Detected: ${signal}`),
      ].join("\n"),
      stderr: result.warnings.join("\n"),
      message: result.ready ? "Preflight passed." : result.warnings.join("; ") || "Preflight failed.",
    };
  },

  async deploy(workspace: string, target: string, production = false, productionConfirmed = false, operationId = crypto.randomUUID()): Promise<NativeResult> {
    const mode = target === "docker" ? "local" : production ? "production" : "preview";
    const result = await call<{ command: BackendCommand }>("deploy_workspace", {
      workspace,
      request: { target, mode, options: null, confirmed: true, productionConfirmed, operationId, timeoutMs: 1_200_000 },
    });
    return fromCommand(result.command);
  },

  async workspaceRollback(workspace: string, commit?: string, operationId = crypto.randomUUID()): Promise<{ operationId: string; restoredCommit: string; stashCreated: boolean }> {
    return await call<{ operationId: string; restoredCommit: string; stashCreated: boolean }>("workspace_rollback", {
      workspace,
      request: { commit: commit ?? null, operationId }
    });
  },

  async reveal(path: string): Promise<void> {
    if (!inTauri()) requireNative();
    await revealItemInDir(path);
  },

  async openPath(path: string): Promise<void> {
    if (!inTauri()) requireNative();
    await openNativePath(path);
  },

  async openUrl(url: string): Promise<void> {
    if (!inTauri()) requireNative();
    await openNativeUrl(url);
  },

  async listChatThreads(): Promise<ChatThreadSummary[]> {
    if (!inTauri()) return [];
    return call<ChatThreadSummary[]>("list_chat_threads");
  },

  async getChatThread(id: string): Promise<ChatThread> {
    return call<ChatThread>("get_chat_thread", { id });
  },

  async saveChatThread(thread: ChatThread): Promise<ChatThread> {
    return call<ChatThread>("save_chat_thread", { thread });
  },

  async deleteChatThread(id: string): Promise<void> {
    return call<void>("delete_chat_thread", { id });
  },

  async clearChatThreads(): Promise<void> {
    return call<void>("clear_chat_threads");
  },

  async openGptSection(section: "Scheduled" | "Plugins" | "Sites" | "Pull requests" | "Chat"): Promise<void> {
    return call<void>("open_gpt_section", { section });
  },

  async readWhimConfig(workspace: string): Promise<Record<string, unknown>> {
    try {
      const raw = await bridge.readFile(workspace, ".whim/config.json");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(".whim/config.json must contain a JSON object.");
      return parsed as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as unknown as { code?: string }).code;
      const isMissing =
        code === "WORKSPACE_PATH_UNRESOLVED" ||
        /not exist|cannot inspect|not found/i.test(message);
      if (isMissing) return {};
      if (error instanceof SyntaxError) {
        const configError = new Error(".whim/config.json is not valid JSON. Fix it before Whim edits integrations.");
        (configError as Error & { cause?: unknown }).cause = error;
        throw configError;
      }
      throw error;
    }
  },

  async writeWhimConfig(workspace: string, config: Record<string, unknown>): Promise<void> {
    await bridge.writeFile(workspace, ".whim/config.json", `${JSON.stringify(config, null, 2)}\n`, true);
  },

  // Zero-config provider discovery for the autonomous (vibecoding) flow.
  // Whim's agent resolves the actual runtime itself; this is for the UI to
  // show what is available and let the user pick a manual override.
  async discoverProviders(): Promise<DiscoveredProvider[]> {
    return call<DiscoveredProvider[]>("discover_providers");
  },

};

function findSessionId(events: unknown[]): string | undefined {
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const value = event as Record<string, unknown>;
    for (const key of ["sessionID", "sessionId", "session_id"]) {
      if (typeof value[key] === "string") return value[key] as string;
    }
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function displayToolName(name: string): string {
  const safeName = sanitizeText(name).slice(0, 80);
  const normalized = safeName.toLowerCase().replace(/[-_\s]+/g, "");
  const known: Record<string, string> = {
    bash: "Bash", read: "Read", write: "Write", edit: "Edit", grep: "Grep", glob: "Glob",
    websearch: "WebSearch", webfetch: "WebFetch", task: "Task", agent: "Agent",
    todowrite: "TodoWrite", planwrite: "PlanWrite", question: "Question", skill: "Skill",
  };
  return known[normalized] ?? safeName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_\s]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const KNOWN_EVENT_TYPES = ["text", "reasoning", "tool_use", "error"] as const;

/**
 * Agent/stdout output is untrusted data. Strip control characters and
 * collapse runaway whitespace before any text reaches the renderer, and cap
 * length so a hostile event cannot flood the UI.
 */
function sanitizeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, "")
    .replace(/\s{3,}/g, "   ")
    .trim()
    .slice(0, 64_000);
}

export function agentEventsToParts(events: unknown[]): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [];
  for (const eventValue of events) {
    const event = record(eventValue);
    if (!event) continue;
    const type = String(event.type ?? "");
    // Treat agent output as untrusted data: only render known, safe event
    // shapes. Unknown types (including any injected "action" directives)
    // are dropped rather than forwarded into the UI.
    if (!KNOWN_EVENT_TYPES.includes(type as (typeof KNOWN_EVENT_TYPES)[number])) continue;
    const part = record(event.part);
    if (type === "text") {
      const text = sanitizeText(typeof part?.text === "string" ? part.text : typeof event.text === "string" ? event.text : "");
      if (text) parts.push({ type: "text", text });
      continue;
    }
    if (type === "reasoning") {
      const thought = sanitizeText(typeof part?.text === "string" ? part.text : "");
      if (thought) parts.push({ type: "tool-Thinking", toolCallId: String(part?.id ?? crypto.randomUUID()), state: "output-available", input: { thought }, output: thought });
      continue;
    }
    if (type === "tool_use" && part) {
      const state = record(part.state);
      const status = String(state?.status ?? "completed");
      const toolName = displayToolName(String(part.tool ?? "Tool"));
      parts.push({
        type: `tool-${toolName}`,
        toolCallId: String(part.id ?? crypto.randomUUID()),
        state: status === "error" ? "output-error" : status === "running" || status === "pending" ? "input-streaming" : "output-available",
        input: record(state?.input) ?? state?.input ?? {},
        output: state?.output ?? (status === "error" ? { error: state?.error ?? "Tool failed" } : undefined),
        errorText: status === "error" ? String(state?.error ?? "Tool failed") : undefined,
      });
      continue;
    }
    if (type === "error") {
      const error = record(event.error);
      const data = record(error?.data);
      const message = typeof data?.message === "string" ? data.message : typeof error?.message === "string" ? error.message : "The agent reported an error.";
      parts.push({ type: "error", title: "Agent error", message });
    }
  }
  return parts;
}

/**
 * A tiny, safe status line for the native live-event rail. It never renders
 * raw tool output or provider reasoning; detailed evidence remains in the
 * final, bounded agent message.
 */
export function agentLiveSummary(eventValue: unknown): string | null {
  const event = record(eventValue);
  if (!event) return null;
  const type = String(event.type ?? "");
  if (type === "progress") {
    const message = sanitizeText(typeof event.message === "string" ? event.message : "");
    return message || "Native agent is working.";
  }
  if (type === "tool_use") {
    const part = record(event.part);
    const state = record(part?.state);
    const tool = displayToolName(String(part?.tool ?? "Tool"));
    const status = String(state?.status ?? "completed");
    return `${status === "error" ? "Tool failed" : status === "running" ? "Running" : "Completed"}: ${tool}`;
  }
  if (type === "error") {
    const error = record(event.error);
    const message = sanitizeText(typeof error?.message === "string" ? error.message : "");
    return message ? `Agent error: ${message.slice(0, 220)}` : "The agent reported an error.";
  }
  if (type === "text") {
    const text = sanitizeText(typeof event.text === "string" ? event.text : "");
    return text ? `Agent update: ${text.slice(0, 220)}` : null;
  }
  if (type === "reasoning") return "Model reasoning updated.";
  return null;
}

/**
 * Convert the native agent's untrusted event stream into bounded, secret-free
 * final audit metadata. The native harness separately appends fixed activity
 * labels to the durable ledger; detailed output remains in the live session.
 */
export function agentRunEvidence(result: Pick<NativeResult, "events" | "durationMs" | "timedOut">): OrchestrationJobEvidence {
  let toolCallCount = 0;
  let failedToolCallCount = 0;
  const events = result.events ?? [];
  for (const eventValue of events) {
    const event = record(eventValue);
    if (event?.type !== "tool_use") continue;
    toolCallCount += 1;
    const state = record(record(event.part)?.state);
    if (state?.status === "error") failedToolCallCount += 1;
  }
  return {
    eventCount: events.length,
    toolCallCount,
    failedToolCallCount,
    durationMs: typeof result.durationMs === "number" ? result.durationMs : null,
    timedOut: Boolean(result.timedOut),
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatStatus, UIMessage } from "ai";
import {
  Bot,
  Check,
  ChevronDown,
  Clock3,
  GitCompareArrows,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { AgentChat } from "./agent-elements/agent-chat";
import { ContextIndexCard } from "./ContextIndexCard";
import { IntentBriefCard } from "./IntentBriefCard";
import { TaskLedger } from "./TaskLedger";
import { VerificationCard } from "./VerificationCard";
import { WorktreeCard } from "./WorktreeCard";
import {
  agentEventsToParts,
  agentLiveSummary,
  agentRunEvidence,
  bridge,
  errorMessage,
  type OrchestrationJob,
  type OrchestrationJobDetail,
  type OrchestrationJobOutcome,
} from "../lib/bridge";
import {
  INTENT_BRIEF_PATH,
  createIntentBrief,
  hasIntentBriefContent,
  intentBriefForAgent,
  parseIntentBrief,
  serializeIntentBrief,
  type IntentBrief,
  type IntentBriefInput,
} from "../lib/intent-brief";
import { buildProjectContextIndex, contextIndexForAgent } from "../lib/context-index";
import { VibePipelineTracker, type PipelineState } from "../lib/vibe-pipeline";
import type { WorkspaceEntry } from "../types/workbench";

type MissionControlProps = {
  workspace: string | null;
  workspaceEntries: readonly WorkspaceEntry[];
  model: string;
  models: string[];
  onModelChange: (model: string) => void;
  hasProvider: boolean;
  onOpenProviders: () => void;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  onRunComplete?: () => void;
  onActivityChange?: (running: boolean) => void;
};

const initialMessages: UIMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    parts: [{ type: "text", text: "Open a workspace, choose a provider and model, then describe the outcome. Whim runs its own native agent in that folder and shows the real tool results here." }],
  } as UIMessage,
];

type MissionAgentMode = "vibe" | "plan" | "build" | "verify" | "review" | "ship";

const agentModes: readonly MissionAgentMode[] = ["vibe", "plan", "build", "verify", "review", "ship"];

const modePrompt: Record<MissionAgentMode, string> = {
  vibe: "Work directly toward the requested outcome. Inspect the existing project first, preserve its direction, make the smallest complete change, and report exactly what changed.",
  plan: "Inspect this project and create a concrete implementation plan with acceptance criteria, risks, files likely to change, and the lightest relevant verification. Do not edit files or run commands.",
  build: "Implement the requested outcome in this workspace. Inspect before editing, complete the necessary code, and run the lightest relevant verification available.",
  verify: "Inspect the relevant implementation and run only safe, native-discovered verification checks. Do not edit files. Report exact evidence, failures, and recommended fixes.",
  review: "Review the relevant implementation and project context without editing files or running commands. Return prioritized findings, risk, evidence, and concrete recommendations.",
  ship: "Prepare the requested outcome for release. Inspect the project, make only necessary changes, run relevant readiness checks, and do not perform a public or production deployment.",
};

function modelLabel(id: string) {
  if (id === "auto") return { label: "Provider default", note: "model auto-select" };
  const [provider, ...model] = id.split("/");
  return { label: model.join("/").replace(/[-_]/g, " ") || id, note: provider || "model" };
}

function sameWorkspace(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.replace(/\\/g, "/").toLowerCase() === right.replace(/\\/g, "/").toLowerCase());
}

export function MissionControl({
  workspace,
  workspaceEntries,
  model,
  models,
  onModelChange,
  hasProvider,
  onOpenProviders,
  provider,
  apiKey,
  baseUrl,
  onRunComplete,
  onActivityChange,
}: MissionControlProps) {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [mode, setMode] = useState<MissionAgentMode>("vibe");
  const [modelOpen, setModelOpen] = useState(false);
  const [lastDuration, setLastDuration] = useState<number | null>(null);
  const sessionId = useRef<string | undefined>(undefined);
  const operationId = useRef<string | undefined>(undefined);
  const [pipeline, setPipeline] = useState<PipelineState>("INTENT");
  const trackerRef = useRef<VibePipelineTracker | null>(null);
  const selectedJobId = useRef<string | null>(null);
  const runningJob = useRef<OrchestrationJob | null>(null);
  const intentBriefRequest = useRef(0);
  const lastLiveLedgerRefresh = useRef(0);
  const [taskJobs, setTaskJobs] = useState<OrchestrationJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<OrchestrationJob | null>(null);
  const [taskDetail, setTaskDetail] = useState<OrchestrationJobDetail | null>(null);
  const [taskLedgerLoading, setTaskLedgerLoading] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [intentBrief, setIntentBrief] = useState<IntentBrief | null>(null);
  const [executionWorkspace, setExecutionWorkspace] = useState<string | null>(workspace);
  const [liveEvents, setLiveEvents] = useState<unknown[]>([]);
  const [executionEntries, setExecutionEntries] = useState<readonly WorkspaceEntry[]>(workspaceEntries);
  if (!trackerRef.current) trackerRef.current = new VibePipelineTracker(setPipeline);

  const executionTarget = executionWorkspace ?? workspace;
  const isolatedExecution = Boolean(executionTarget && workspace && !sameWorkspace(executionTarget, workspace));

  const options = useMemo(() => {
    const base = ["auto", ...models.filter((item, index) => models.indexOf(item) === index)];
    if (provider !== "local" && model && !base.includes(model)) return [...base, model];
    return base;
  }, [models, model, provider]);
  const activeModel = useMemo(() => modelLabel(options.includes(model) ? model : "auto"), [model, options]);
  const contextIndex = useMemo(
    () => buildProjectContextIndex(executionEntries),
    [executionEntries],
  );
  const liveActivity = useMemo(() => {
    for (let index = liveEvents.length - 1; index >= 0; index -= 1) {
      const summary = agentLiveSummary(liveEvents[index]);
      if (summary) return summary;
    }
    return null;
  }, [liveEvents]);

  const loadTaskDetail = useCallback(async (job: OrchestrationJob) => {
    selectedJobId.current = job.id;
    setSelectedJob(job);
    setTaskDetail(null);
    if (!bridge.isNative()) return;
    try {
      const detail = await bridge.getOrchestrationJob(job.workspace, job.id);
      if (selectedJobId.current === job.id) setTaskDetail(detail);
    } catch {
      // The live task remains usable if a historical detail cannot be read.
    }
  }, []);

  const refreshTaskLedger = useCallback(async (preferredJobId?: string) => {
    if (!executionTarget || !bridge.isNative()) {
      selectedJobId.current = null;
      setTaskJobs([]);
      setSelectedJob(null);
      setTaskDetail(null);
      return;
    }
    setTaskLedgerLoading(true);
    try {
      const jobs = await bridge.listProjectOrchestrationJobs();
      setTaskJobs(jobs);
      const chosenId = preferredJobId ?? selectedJobId.current;
      const targetJobs = jobs.filter((job) => sameWorkspace(job.workspace, executionTarget));
      const next =
        jobs.find((job) => job.id === chosenId) ??
        targetJobs.find((job) => ["queued", "running", "paused", "interrupted"].includes(job.status)) ??
        targetJobs[0] ??
        jobs.find((job) => ["queued", "running", "paused", "interrupted"].includes(job.status)) ??
        jobs[0] ??
        null;
      if (next) await loadTaskDetail(next);
      else {
        selectedJobId.current = null;
        setSelectedJob(null);
        setTaskDetail(null);
      }
    } catch {
      // Task persistence must not block the chat surface; a native run will
      // refuse to start below if its new task record cannot be created.
    } finally {
      setTaskLedgerLoading(false);
    }
  }, [executionTarget, loadTaskDetail]);

  const loadIntentBrief = useCallback(async () => {
    const request = ++intentBriefRequest.current;
    setIntentBrief(null);
    if (!executionTarget || !bridge.isNative()) return;
    try {
      const serialized = await bridge.readFile(executionTarget, INTENT_BRIEF_PATH);
      if (request === intentBriefRequest.current) setIntentBrief(parseIntentBrief(serialized));
    } catch {
      // A brief is optional. Missing or malformed project files remain visible
      // as an empty brief rather than being silently fabricated.
    }
  }, [executionTarget]);

  const saveIntentBrief = useCallback(async (input: IntentBriefInput) => {
    if (!executionTarget || !bridge.isNative()) {
      throw new Error("Open a project in the installed Windows app to save an intent brief.");
    }
    const next = createIntentBrief(input);
    if (!hasIntentBriefContent(next)) throw new Error("Add project intent before saving the brief.");
    const request = ++intentBriefRequest.current;
    await bridge.writeFile(executionTarget, INTENT_BRIEF_PATH, serializeIntentBrief(next), true);
    if (request === intentBriefRequest.current) setIntentBrief(next);
  }, [executionTarget]);

  const runQueuedAttempt = useCallback(async (job: OrchestrationJob) => {
    if (!bridge.isNative() || status !== "ready") return;
    if (job.mode === "operate") {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "error", title: "Attempt unavailable", message: "Operate mode is not implemented in the native agent boundary." }],
      } as unknown as UIMessage]);
      return;
    }
    const nextOperation = job.operationId;
    if (!nextOperation) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "error", title: "Attempt unavailable", message: "This queued task has no durable operation identity." }],
      } as unknown as UIMessage]);
      return;
    }
    let started: OrchestrationJob | null = null;
    setRetryingJobId(job.id);
    setStatus("submitted");
    onActivityChange?.(true);
    try {
      started = await bridge.transitionOrchestrationJob(job.workspace, job.id, "start");
      runningJob.current = started;
      operationId.current = nextOperation;
      selectedJobId.current = started.id;
      setSelectedJob(started);
      setTaskDetail(null);
      setLiveEvents([]);
      setStatus("streaming");
      void refreshTaskLedger(started.id);

      const retryProvider = job.provider || provider;
      const usesCurrentProvider = retryProvider === provider;
      const result = await bridge.runAgent({
        workspace: job.workspace,
        prompt: `Retry this durable Whim task after a failed or interrupted attempt. Re-evaluate the current workspace state and do not assume earlier edits completed.\n\nDurable task context:\n${job.intent}`,
        model: job.model || undefined,
        agent: job.mode === "vibe" ? undefined : job.mode,
        operationId: nextOperation,
        autoApprove: false,
        provider: retryProvider,
        apiKey: usesCurrentProvider ? apiKey : undefined,
        baseUrl: usesCurrentProvider ? baseUrl : undefined,
        autoContinue: true,
        timeoutMs: job.budget.maxDurationMs,
        onEvent: (event) => {
          setLiveEvents((current) => [...current, event].slice(-64));
          if (Date.now() - lastLiveLedgerRefresh.current >= 750) {
            lastLiveLedgerRefresh.current = Date.now();
            void refreshTaskLedger(job.id);
          }
        },
      });
      const evidence = agentRunEvidence(result);
      const outcome: OrchestrationJobOutcome = result.cancelled ? "cancelled" : result.success ? "completed" : "failed";
      const finished = await bridge.finishOrchestrationJob({
        workspace: job.workspace,
        jobId: job.id,
        outcome,
        summary: result.cancelled
          ? "Retried native run was cancelled by the user."
          : result.success
            ? "Retried native run completed; inspect the workspace diff and evidence."
            : "Retried native run reported a failure.",
        evidence,
      });
      setSelectedJob(finished);
      selectedJobId.current = finished.id;
      const parts = agentEventsToParts(result.events ?? []);
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: parts.length ? parts : [{ type: "text", text: result.message || "Retry finished without a text response." }],
      } as unknown as UIMessage]);
      onRunComplete?.();
      void refreshTaskLedger(finished.id);
    } catch (cause) {
      if (started) {
        try {
          await bridge.finishOrchestrationJob({
            workspace: started.workspace,
            jobId: started.id,
            outcome: "failed",
            summary: "Retried native agent could not start or complete.",
            evidence: { eventCount: 0, toolCallCount: 0, failedToolCallCount: 0, durationMs: null, timedOut: false },
          });
        } catch { /* A refresh will surface an unresolved attempt. */ }
      }
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "error", title: "Attempt failed", message: errorMessage(cause) }],
      } as unknown as UIMessage]);
      void refreshTaskLedger(job.id);
    } finally {
      operationId.current = undefined;
      runningJob.current = null;
      setRetryingJobId(null);
      setLiveEvents([]);
      setStatus("ready");
      onActivityChange?.(false);
    }
  }, [apiKey, baseUrl, onActivityChange, onRunComplete, provider, refreshTaskLedger, status]);

  const retryTask = useCallback(async (job: OrchestrationJob) => {
    if (!bridge.isNative() || status !== "ready" || retryingJobId) return;
    setRetryingJobId(job.id);
    try {
      const queued = await bridge.retryOrchestrationJob({
        workspace: job.workspace,
        jobId: job.id,
        operationId: crypto.randomUUID(),
        delayMs: 0,
      });
      setRetryingJobId(null);
      await runQueuedAttempt(queued);
    } catch (cause) {
      setRetryingJobId(null);
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "error", title: "Could not schedule retry", message: errorMessage(cause) }],
      } as unknown as UIMessage]);
      void refreshTaskLedger(job.id);
    }
  }, [refreshTaskLedger, retryingJobId, runQueuedAttempt, status]);

  const dispatchTask = useCallback(async (job: OrchestrationJob) => {
    if (!bridge.isNative() || status !== "ready" || retryingJobId) return;
    const dispatchProvider = job.provider || provider;
    const usesCurrentProvider = dispatchProvider === provider;
    setRetryingJobId(job.id);
    try {
      const running = await bridge.dispatchOrchestrationJob({
        workspace: job.workspace,
        jobId: job.id,
        apiKey: usesCurrentProvider ? apiKey : undefined,
        baseUrl: usesCurrentProvider ? baseUrl : undefined,
      });
      selectedJobId.current = running.id;
      setSelectedJob(running);
      setTaskDetail(null);
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: `Background attempt ${running.attempt}/${running.budget.maxAttempts} started in ${running.workspace}. Its fixed-label activity and final result will remain in the durable task ledger.` }],
      } as unknown as UIMessage]);
      void refreshTaskLedger(running.id);
    } catch (cause) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "error", title: "Background dispatch failed", message: errorMessage(cause) }],
      } as unknown as UIMessage]);
      void refreshTaskLedger(job.id);
    } finally {
      setRetryingJobId(null);
    }
  }, [apiKey, baseUrl, provider, refreshTaskLedger, retryingJobId, status]);

  const cancelTask = useCallback(async (job: OrchestrationJob) => {
    if (!job.operationId || retryingJobId) return;
    setRetryingJobId(job.id);
    try {
      await bridge.cancelOperation(job.operationId);
      if (job.status === "running") {
        await bridge.transitionOrchestrationJob(job.workspace, job.id, "cancel");
      }
    } catch (cause) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "error", title: "Cancellation failed", message: errorMessage(cause) }],
      } as unknown as UIMessage]);
    } finally {
      setRetryingJobId(null);
      void refreshTaskLedger(job.id);
    }
  }, [refreshTaskLedger, retryingJobId]);

  useEffect(() => {
    const focus = () => document.querySelector<HTMLTextAreaElement>(".mission-control textarea")?.focus();
    window.addEventListener("whim:focus-agent", focus);
    return () => window.removeEventListener("whim:focus-agent", focus);
  }, []);

  useEffect(() => {
    setExecutionWorkspace(workspace);
  }, [workspace]);

  useEffect(() => {
    let active = true;
    if (!executionTarget || !bridge.isNative()) {
      setExecutionEntries(workspaceEntries);
      return () => { active = false; };
    }
    void bridge.listWorkspace(executionTarget)
      .then((entries) => { if (active) setExecutionEntries(entries); })
      .catch(() => { if (active) setExecutionEntries([]); });
    return () => { active = false; };
  }, [executionTarget, workspaceEntries]);

  useEffect(() => {
    sessionId.current = undefined;
    runningJob.current = null;
    setMessages(initialMessages);
    setPipeline("INTENT");
    selectedJobId.current = null;
    setTaskJobs([]);
    setSelectedJob(null);
    setTaskDetail(null);
    setLiveEvents([]);
    lastLiveLedgerRefresh.current = 0;
    void refreshTaskLedger();
    void loadIntentBrief();
  }, [executionTarget, loadIntentBrief, refreshTaskLedger, workspace]);

  useEffect(() => {
    if (!bridge.isNative() || !taskJobs.some((job) => job.status === "running")) return;
    const interval = window.setInterval(() => void refreshTaskLedger(), 1_000);
    return () => window.clearInterval(interval);
  }, [refreshTaskLedger, taskJobs]);

  const send = async ({ content }: { role: "user"; content: string }) => {
    if (!workspace) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "error", title: "No workspace open", message: "Open a project folder before starting an agent." }],
      } as unknown as UIMessage]);
      return;
    }

    let policyContext = "";
    let policyAuditContext = "";
    if (provider !== "local" && provider !== "auto" && (!model || model === "auto")) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "error", title: "Model required", message: "Select a concrete model for this provider in Providers before running the agent." }],
      } as unknown as UIMessage]);
      return;
    }
    try {
      const policy = JSON.parse(await bridge.readFile(executionTarget ?? workspace, ".whim/automation.json")) as { enabled?: Record<string, boolean> };
      if (policy.enabled?.route === false && provider !== "auto" && model === "auto") {
        setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "error", title: "Explicit model required", message: "Project routing is disabled. Select a concrete provider/model before running." }] } as unknown as UIMessage]);
        return;
      }
      const directives: Record<string, string> = {
        repair: "repair routine lint, type, formatting, and test failures you encounter",
        journeys: "run the lightest relevant real user-journey check",
        security: "stop and report before changing auth, payments, secrets, policies, or destructive migrations",
        docs: "update project knowledge when the implementation changes a durable decision",
        checkpoint: "summarize a reversible checkpoint after accepted work",
        "deploy-preview": "prepare preview deployment readiness but do not deploy publicly or to production",
      };
      const active = Object.entries(policy.enabled ?? {}).filter(([, enabled]) => enabled).map(([id]) => directives[id]).filter(Boolean);
      if (active.length) {
        policyAuditContext = `Workspace automation policy:\n- ${active.join("\n- ")}`;
        policyContext = `\n\n${policyAuditContext}`;
      }
    } catch { /* no project policy file yet */ }

    const userMessage: UIMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: content }] };
    setMessages((current) => [...current, userMessage]);
    setLiveEvents([]);
    lastLiveLedgerRefresh.current = 0;
    setStatus("submitted");
    onActivityChange?.(true);
    const currentOperation = crypto.randomUUID();
    operationId.current = currentOperation;
    let durableJob: OrchestrationJob | null = null;
    const briefContext = intentBriefForAgent(intentBrief);
    const contextInventory = contextIndexForAgent(contextIndex);
    const regionContext = "";
    // Persist the same bounded, secret-aware context that is supplied to the
    // run. This makes a historical task explainable even after the workspace
    // has changed, without retaining provider keys or raw tool output.
    const auditIntent = [
      `User outcome:\n${content}`,
      isolatedExecution ? "Execution target: isolated registered Git worktree. Its own intent brief, repository inventory, automation policy, and native project memory were used." : "Execution target: selected workspace.",
      policyAuditContext,
      briefContext ? `Saved intent brief used:\n${briefContext}` : "",
      contextInventory ? `Repository inventory used:\n${contextInventory}` : "",
      regionContext ? `Preview annotation used:\n${regionContext}` : "",
    ].filter(Boolean).join("\n\n");

    if (bridge.isNative()) {
      try {
        durableJob = await bridge.createOrchestrationJob({
          workspace: executionTarget ?? workspace,
          intent: auditIntent,
          title: content,
          mode,
          operationId: currentOperation,
          provider,
          model: model === "auto" ? undefined : model,
        });
        durableJob = await bridge.transitionOrchestrationJob(durableJob.workspace, durableJob.id, "start");
        runningJob.current = durableJob;
        selectedJobId.current = durableJob.id;
        setSelectedJob(durableJob);
        setTaskDetail(null);
        void refreshTaskLedger(durableJob.id);
      } catch (error) {
        operationId.current = undefined;
        setStatus("ready");
        onActivityChange?.(false);
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [{ type: "error", title: "Could not record this task", message: `${errorMessage(error)} The native agent did not start without a durable task record.` }],
        } as unknown as UIMessage]);
        return;
      }
    }

    const finishDurableJob = async (
      outcome: OrchestrationJobOutcome,
      summary: string,
      evidence: ReturnType<typeof agentRunEvidence>,
    ) => {
      if (!durableJob) return;
      try {
        const finished = await bridge.finishOrchestrationJob({
          workspace: durableJob.workspace,
          jobId: durableJob.id,
          outcome,
          summary,
          evidence,
        });
        selectedJobId.current = finished.id;
        runningJob.current = null;
        setSelectedJob(finished);
        void refreshTaskLedger(finished.id);
      } catch {
        // The live result remains visible. A later refresh will surface the
        // unresolved task instead of pretending the audit write succeeded.
      }
    };

    try {
      setStatus("streaming");
      trackerRef.current?.transitionTo(mode === "plan" ? "SHAPE" : mode === "verify" || mode === "review" ? "VERIFY" : mode === "ship" ? "SHIP" : "BUILD");
      const result = await bridge.runAgent({
        workspace: executionTarget ?? workspace,
        prompt: `${modePrompt[mode]}${policyContext}${briefContext ? `\n\n${briefContext}` : ""}${contextInventory ? `\n\n${contextInventory}` : ""}${regionContext ? `\n\n${regionContext}` : ""}\n\nCurrent user outcome:\n${content}`,
        model: model === "auto" ? undefined : model,
        agent: mode === "vibe" ? undefined : mode,
        sessionId: sessionId.current,
        operationId: currentOperation,
        autoApprove: false,
        provider,
        apiKey,
        baseUrl,
        autoContinue: true,
        timeoutMs: durableJob?.budget.maxDurationMs,
        onEvent: (event) => {
          setLiveEvents((current) => [...current, event].slice(-64));
          // Native tool events are written into the local ledger before they
          // are emitted to this window. Refresh at a small fixed cadence so
          // the review rail remains live without turning every provider event
          // into a filesystem read.
          if (durableJob && Date.now() - lastLiveLedgerRefresh.current >= 750) {
            lastLiveLedgerRefresh.current = Date.now();
            void refreshTaskLedger(durableJob.id);
          }
        },
      });
      sessionId.current = result.sessionId ?? sessionId.current;
      setLastDuration(typeof result.durationMs === "number" ? result.durationMs : null);
      const evidence = agentRunEvidence(result);

      let parts = agentEventsToParts(result.events ?? []);
      if (result.cancelled) {
        parts = [...parts, { type: "text", text: "Stopped. Any changes completed before cancellation remain in the workspace." }];
        await finishDurableJob("cancelled", "Native run was cancelled by the user.", evidence);
      } else if (!result.success) {
        const message = result.stderr?.trim() || result.message || (result.timedOut ? "The agent timed out." : "The agent could not complete this request.");
        parts = [...parts, { type: "error", title: "Agent run failed", message }];
        await finishDurableJob(
          "failed",
          result.timedOut
            ? "Native run exceeded its task time budget."
            : "Native run reported a failure; inspect the session evidence.",
          evidence,
        );
      } else if (parts.length === 0) {
        parts = [{ type: "text", text: result.stdout?.trim() || "The agent completed without a text response." }];
        await finishDurableJob("completed", "Native run completed without a text response.", evidence);
      } else {
        await finishDurableJob("completed", "Native run completed; inspect the session and workspace diff.", evidence);
      }

      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", parts } as unknown as UIMessage]);
      if (result.cancelled) {
        trackerRef.current?.transitionTo("FAILED");
      } else if (!result.success) {
        trackerRef.current?.transitionTo("FAILED");
      } else {
        trackerRef.current?.transitionTo("VERIFY");
      }
      onRunComplete?.();
    } catch (error) {
      await finishDurableJob("failed", "Native agent could not start or complete this task.", {
        eventCount: 0,
        toolCallCount: 0,
        failedToolCallCount: 0,
        durationMs: null,
        timedOut: false,
      });
      const message = errorMessage(error);
      const code = (error as { code?: string } | null)?.code;
      const hint = code === "AGENT_START" || code === "AGENT_RUN"
        ? " Open Providers to choose a runtime or paste a key."
        : "";
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "error", title: "Could not start the agent", message: message + hint }],
      } as unknown as UIMessage]);
      trackerRef.current?.transitionTo("FAILED");
    } finally {
      operationId.current = undefined;
      runningJob.current = null;
      setLiveEvents([]);
      setStatus("ready");
      onActivityChange?.(false);
    }
  };

  const stop = async () => {
    const active = operationId.current;
    if (!active) return;
    try {
      const cancelled = await bridge.cancelOperation(active);
      const taskToCancel = runningJob.current;
      if (cancelled && taskToCancel && ["queued", "running", "paused", "interrupted"].includes(taskToCancel.status)) {
        try {
          const task = await bridge.transitionOrchestrationJob(taskToCancel.workspace, taskToCancel.id, "cancel");
          runningJob.current = task;
          selectedJobId.current = task.id;
          setSelectedJob(task);
          void refreshTaskLedger(task.id);
        } catch {
          // The native cancellation remains the source of truth; the result
          // handler will make a second, idempotent ledger attempt.
        }
      }
    } finally {
      setStatus("ready");
    }
  };

  useEffect(() => {
    const stopAgent = () => void stop();
    window.addEventListener("whim:stop-agent", stopAgent);
    return () => window.removeEventListener("whim:stop-agent", stopAgent);
  });

  const newSession = () => {
    sessionId.current = undefined;
    setMessages(initialMessages);
  };

  return (
    <aside className="mission-control">
      <div className="mission-header">
        <div className="mission-title"><span className="mission-avatar"><Sparkles size={14} /></span><div><strong>Whim</strong><small>{workspace ? isolatedExecution ? "Native agent · isolated worktree" : "Native agent · selected workspace" : "Open a workspace to begin"}</small></div></div>
        <div className="mission-actions">
          <button type="button" aria-label="Start a new agent session" title="New agent session" onClick={newSession}><GitCompareArrows size={15} /></button>
        </div>
      </div>

      <div className="mode-segment" role="tablist" aria-label="Agent mode">
        {agentModes.map((item) => (
          <button className={mode === item ? "active" : ""} type="button" role="tab" aria-selected={mode === item} key={item} title={`${item[0].toUpperCase() + item.slice(1)} mode`} onClick={() => setMode(item)}>
            {item === "vibe" && <WandSparkles size={12} />}{item === "plan" && <GitCompareArrows size={12} />}{item === "build" && <Bot size={12} />}{item === "verify" && <Check size={12} />}{item === "review" && <Bot size={12} />}{item === "ship" && <ShieldCheck size={12} />}
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      <WorktreeCard
        native={bridge.isNative()}
        workspace={workspace}
        executionWorkspace={executionTarget}
        running={status !== "ready"}
        onExecutionWorkspaceChange={setExecutionWorkspace}
      />

      {isolatedExecution && (
        <div className="execution-context-notice">
          <GitCompareArrows size={11} />
          <span><strong>Isolated context</strong><small>Brief, policy, and index are loaded from the selected worktree. Preview marks remain attached only to the source workspace.</small></span>
        </div>
      )}

      <TaskLedger
        native={bridge.isNative()}
        jobs={taskJobs}
        activeJob={selectedJob}
        detail={taskDetail}
        loading={taskLedgerLoading}
        onRefresh={() => void refreshTaskLedger()}
        onSelect={(job) => void loadTaskDetail(job)}
        onRetry={(job) => void retryTask(job)}
        onResume={(job) => void runQueuedAttempt(job)}
        onBackground={(job) => void dispatchTask(job)}
        onCancel={(job) => void cancelTask(job)}
        retrying={retryingJobId !== null}
      />

      <IntentBriefCard
        native={bridge.isNative()}
        workspaceOpen={Boolean(executionTarget)}
        brief={intentBrief}
        onSave={saveIntentBrief}
      />

      {executionTarget && <ContextIndexCard native={bridge.isNative()} workspaceOpen index={contextIndex} />}

      <VerificationCard
        native={bridge.isNative()}
        workspace={executionTarget}
        activeJob={selectedJob}
        events={taskDetail?.events}
        onRunComplete={isolatedExecution ? undefined : onRunComplete}
      />

      {/* preview-region selection removed: the simulated live preview surface is gone */}

      {!hasProvider && (
        <button className="provider-nudge" type="button" onClick={onOpenProviders}>
          <span><span className="nudge-icon"><Sparkles size={13} /></span><span><strong>Connect a provider or local model</strong><small>Cloud accounts, gateways, and local endpoints</small></span></span>
          <ChevronDown className="sideways" size={14} />
        </button>
      )}

      {status !== "ready" && (
        <div className="agent-live-activity" aria-live="polite" aria-label="Live native agent activity">
          <span><LoaderCircle className="spin" size={12} /></span>
          <div><small>Live native activity</small><strong>{liveActivity ?? "Waiting for the next native agent event…"}</strong></div>
          <em>{liveEvents.length} event{liveEvents.length === 1 ? "" : "s"}</em>
        </div>
      )}

      <div className="agent-chat-wrap">
        <AgentChat
          messages={messages}
          status={status}
          onSend={send}
          onStop={stop}
          showCopyToolbar
          suggestions={workspace ? [
            { id: "inspect", label: "Understand this project", value: "Inspect this project and explain the main user journey, architecture, and the best next improvement. Do not edit yet." },
            { id: "fix", label: "Find and fix a blocker", value: "Find the most obvious user-facing blocker in this project, fix it completely, and run the lightest relevant check." },
            { id: "ready", label: "Make it release-ready", value: "Prepare this project for a private preview. Fix readiness issues and report anything that still needs a human decision." },
          ] : []}
          classNames={{ root: "whim-agent-chat", inputBar: "whim-input-bar", userMessage: "whim-user-message" }}
        />
      </div>

      <div className="agent-footer">
        <div className="model-select-wrap">
          <button className="agent-model-select" type="button" onClick={() => setModelOpen((value) => !value)}>
            <span className="model-spark"><Sparkles size={11} /></span><span><strong>{activeModel.label}</strong><small>{activeModel.note}</small></span><ChevronDown size={12} />
          </button>
          {modelOpen && (
            <div className="model-menu">
              {options.map((item) => {
                const label = modelLabel(item);
                return <button key={item} type="button" onClick={() => { onModelChange(item); setModelOpen(false); }}><span>{label.label}<small>{label.note}</small></span>{item === model && <Check size={13} />}</button>;
              })}
              {models.length === 0 && <button type="button" disabled><span>No models discovered<small>Connect a provider, then refresh</small></span></button>}
              <button className="manage-models" type="button" onClick={onOpenProviders}>Manage providers</button>
            </div>
          )}
        </div>
        <div className="agent-metrics" aria-label="Agent pipeline and run state">
          {status !== "ready"
            ? <span><LoaderCircle className="spin" size={12} /> {pipeline.toLowerCase()}</span>
            : lastDuration !== null
              ? <span title="Last native run"><Clock3 size={12} /> {(lastDuration / 1000).toFixed(1)}s · {pipeline.toLowerCase()}</span>
              : <span><ShieldCheck size={12} /> {pipeline.toLowerCase()}</span>}
        </div>
      </div>
    </aside>
  );
}

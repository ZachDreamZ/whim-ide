import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  NativeResult,
  OrchestrationJob,
  OrchestrationJobMode,
  OrchestrationJobOutcome,
} from "./bridge";

export type MissionGraphPhase = "prepare" | "persist" | "execute" | "finalize";

export type MissionGraphRequest = {
  workspace: string;
  operationId: string;
  prompt: string;
  auditIntent: string;
  title: string;
  mode: OrchestrationJobMode;
  agent?: string;
  provider: string;
  model?: string;
};

export type MissionGraphAdapters = {
  onPhase?: (phase: MissionGraphPhase) => void | Promise<void>;
  persist: (request: MissionGraphRequest) => Promise<OrchestrationJob>;
  execute: (
    request: MissionGraphRequest,
    job: OrchestrationJob,
  ) => Promise<NativeResult>;
  finalize: (input: {
    job: OrchestrationJob;
    outcome: OrchestrationJobOutcome;
    summary: string;
    result: NativeResult | null;
    executionError: Error | null;
  }) => Promise<void>;
};

const READ_ONLY_AGENTS = new Set([
  "planner",
  "researcher",
  "reviewer",
  "tester",
  "securityReviewer",
]);

/** Select an OmniRoute alias only when the user has not chosen a model. */
export function resolveMissionModel(
  provider: string,
  requestedModel: string | undefined,
  agent: string | undefined,
): string | undefined {
  const requested = requestedModel?.trim();
  if (requested && requested !== "auto") return requested;
  if (provider.toLowerCase() !== "omniroute") return undefined;
  return READ_ONLY_AGENTS.has(agent ?? "") ? "auto/cheap" : "auto/coding";
}

function resultOutcome(result: NativeResult): OrchestrationJobOutcome {
  if (result.cancelled) return "cancelled";
  return result.success ? "completed" : "failed";
}

function resultSummary(result: NativeResult): string {
  if (result.cancelled) return "Native run was cancelled by the user.";
  if (result.success) return result.events?.length
    ? "Native run completed; inspect the session and workspace diff."
    : "Native run completed without a text response.";
  if (result.timedOut) return "Native run exceeded its task time budget.";
  return "Native run reported a failure; inspect the session evidence.";
}

const MissionState = Annotation.Root({
  request: Annotation<MissionGraphRequest>(),
  job: Annotation<OrchestrationJob | null>(),
  result: Annotation<NativeResult | null>(),
  executionError: Annotation<Error | null>(),
  outcome: Annotation<OrchestrationJobOutcome | null>(),
  summary: Annotation<string>(),
  finalizationError: Annotation<string | null>(),
});

/**
 * Run the mission lifecycle as a LangGraph workflow. The graph coordinates
 * renderer-side control flow; Rust remains authoritative for durable job state,
 * cancellation, evidence, provider calls, and workspace permissions.
 */
export async function runMissionGraph(
  input: MissionGraphRequest,
  adapters: MissionGraphAdapters,
) {
  const graph = new StateGraph(MissionState)
    .addNode("prepare", async (state) => {
      await adapters.onPhase?.("prepare");
      if (!state.request.workspace.trim()) throw new Error("A workspace is required.");
      if (!state.request.prompt.trim()) throw new Error("A prompt is required.");
      return {
        request: {
          ...state.request,
          model: resolveMissionModel(
            state.request.provider,
            state.request.model,
            state.request.agent,
          ),
        },
      };
    })
    .addNode("persist", async (state) => {
      await adapters.onPhase?.("persist");
      return { job: await adapters.persist(state.request) };
    })
    .addNode("execute", async (state) => {
      await adapters.onPhase?.("execute");
      if (!state.job) throw new Error("Mission ledger record is missing.");
      try {
        const result = await adapters.execute(state.request, state.job);
        return {
          result,
          executionError: null,
          outcome: resultOutcome(result),
          summary: resultSummary(result),
        };
      } catch (error) {
        const executionError = error instanceof Error ? error : new Error(String(error));
        return {
          result: null,
          executionError,
          outcome: "failed" as const,
          summary: "Native agent could not start or complete this task.",
        };
      }
    })
    .addNode("finalize", async (state) => {
      await adapters.onPhase?.("finalize");
      if (!state.job || !state.outcome) return {};
      try {
        await adapters.finalize({
          job: state.job,
          outcome: state.outcome,
          summary: state.summary,
          result: state.result,
          executionError: state.executionError,
        });
        return { finalizationError: null };
      } catch (error) {
        return {
          finalizationError: error instanceof Error ? error.message : String(error),
        };
      }
    })
    .addEdge(START, "prepare")
    .addEdge("prepare", "persist")
    .addEdge("persist", "execute")
    .addEdge("execute", "finalize")
    .addEdge("finalize", END)
    .compile();

  return graph.invoke({
    request: input,
    job: null,
    result: null,
    executionError: null,
    outcome: null,
    summary: "",
    finalizationError: null,
  });
}

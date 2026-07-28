import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  MultiAgentJobRequest,
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
 * 
 * This implementation ensures transactional consistency: if any phase fails,
 * the Rust ledger is updated with the appropriate error state for recovery.
 */
export async function runMissionGraph(
  input: MissionGraphRequest,
  adapters: MissionGraphAdapters,
) {
  let job: OrchestrationJob | null = null;
  let executionError: Error | null = null;

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
      try {
        job = await adapters.persist(state.request);
        return { job, finalizationError: null };
      } catch (error) {
        executionError = error instanceof Error ? error : new Error(String(error));
        return { 
          job: null, 
          finalizationError: `Failed to create durable ledger record: ${executionError.message}` 
        };
      }
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
        executionError = error instanceof Error ? error : new Error(String(error));
        return {
          result: null,
          executionError,
          outcome: "failed" as const,
          summary: `Native agent execution failed: ${executionError.message}`,
        };
      }
    })
    .addNode("finalize", async (state) => {
      await adapters.onPhase?.("finalize");
      if (!state.job) {
        // If we never got a ledger record, we can't finalize - this is a critical failure
        return { 
          finalizationError: state.finalizationError || "Cannot finalize: no ledger record exists" 
        };
      }
      
      if (!state.outcome) {
        // If execution failed to produce an outcome, mark as failed
        state.outcome = "failed";
        state.summary = state.summary || "Task failed to complete";
      }
      
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
        const finalError = error instanceof Error ? error.message : String(error);
        // Even if finalization fails, the Rust ledger has the execution state
        // Log this but don't fail the entire operation
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error(`Mission finalization failed: ${finalError}`);
        }
        return { finalizationError: finalError };
      }
    })
    .addEdge(START, "prepare")
    .addEdge("prepare", "persist")
    .addEdge("persist", "execute")
    .addEdge("execute", "finalize")
    .addEdge("finalize", END)
    .compile();

  try {
    const result = await graph.invoke({
      request: input,
      job: null,
      result: null,
      executionError: null,
      outcome: null,
      summary: "",
      finalizationError: null,
    });
    
    // If we have a finalization error but a job, the Rust ledger has the state
    // This is recoverable, so we return success with a warning
    if (result.finalizationError && job) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`Mission completed with finalization warning: ${result.finalizationError}`);
      }
    }
    
    return result;
  } catch (error) {
    // Catastrophic failure - LangGraph itself failed
    // Attempt to record failure in Rust ledger if we have a job
    if (job) {
      try {
        await adapters.finalize({
          job,
          outcome: "failed",
          summary: `Catastrophic workflow failure: ${error instanceof Error ? error.message : String(error)}`,
          result: null,
          executionError: error instanceof Error ? error : new Error(String(error)),
        });
      } catch (finalizeError) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error(`Failed to record catastrophic failure in ledger: ${finalizeError}`);
        }
      }
    }
    throw error;
  }
}

/**
 * Multi-agent mission graph — fan-out sub-tasks across available providers.
 * Uses the Rust `dispatch_multi_agent_job` command which handles the
 * parallel execution, retry, and synthesis internally.
 */
export type MultiAgentPhase = "decompose" | "dispatch" | "gather";

export type MultiAgentAdapters = {
  onPhase?: (phase: MultiAgentPhase) => void | Promise<void>;
  dispatch: (input: MultiAgentJobRequest) => Promise<OrchestrationJob>;
  onResult: (job: OrchestrationJob) => void | Promise<void>;
};

export async function runMultiAgentGraph(
  input: MultiAgentJobRequest,
  adapters: MultiAgentAdapters,
) {
  await adapters.onPhase?.("decompose");
  
  await adapters.onPhase?.("dispatch");
  const job = await adapters.dispatch(input);
  
  await adapters.onPhase?.("gather");
  await adapters.onResult(job);
  
  return job;
}

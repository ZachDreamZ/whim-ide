import { describe, expect, it, vi } from "vitest";
import type { NativeResult, OrchestrationJob } from "./bridge";
import { resolveMissionModel, runMissionGraph } from "./mission-graph";

const job = {
  id: "job-1",
  workspace: "C:\\work",
  budget: { maxDurationMs: 30_000, maxToolIterations: 10, maxAttempts: 1 },
} as OrchestrationJob;

function nativeResult(patch: Partial<NativeResult> = {}): NativeResult {
  return { success: true, events: [{ type: "message" }], ...patch };
}

const request = {
  workspace: "C:\\work",
  operationId: "op-1",
  prompt: "Build it",
  auditIntent: "Build it",
  title: "Build it",
  mode: "build" as const,
  agent: "implementer",
  provider: "omniroute",
};

describe("mission graph", () => {
  it("uses cheap routes for read-only work and coding routes for writes", () => {
    expect(resolveMissionModel("omniroute", undefined, "researcher")).toBe("auto/cheap");
    expect(resolveMissionModel("omniroute", undefined, "implementer")).toBe("auto/coding");
    expect(resolveMissionModel("openai", undefined, "researcher")).toBeUndefined();
    expect(resolveMissionModel("omniroute", "provider/model", "researcher")).toBe("provider/model");
  });

  it("persists before execution and always finalizes a successful run", async () => {
    const order: string[] = [];
    const execute = vi.fn(async () => { order.push("execute"); return nativeResult(); });
    const finalize = vi.fn(async () => { order.push("finalize"); });
    const state = await runMissionGraph(request, {
      onPhase: (phase) => { order.push(phase); },
      persist: async () => { order.push("persist-call"); return job; },
      execute,
      finalize,
    });

    expect(state.outcome).toBe("completed");
    expect(state.request.model).toBe("auto/coding");
    expect(order.indexOf("persist-call")).toBeLessThan(order.indexOf("execute"));
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("records execution failures through the finalization node", async () => {
    const finalize = vi.fn(async () => undefined);
    const state = await runMissionGraph(request, {
      persist: async () => job,
      execute: async () => { throw new Error("provider unavailable"); },
      finalize,
    });

    expect(state.outcome).toBe("failed");
    expect(state.executionError?.message).toBe("provider unavailable");
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  });

  it("maps cancellation to the durable cancelled outcome", async () => {
    const state = await runMissionGraph(request, {
      persist: async () => job,
      execute: async () => nativeResult({ success: false, cancelled: true }),
      finalize: async () => undefined,
    });
    expect(state.outcome).toBe("cancelled");
  });
});

import { describe, expect, it } from "vitest";
import { VibePipelineTracker } from "./vibe-pipeline";

describe("VibePipelineTracker", () => {
  it("moves only after a successful execution step resolves", async () => {
    const changes: string[] = [];
    const tracker = new VibePipelineTracker((state) => changes.push(state));

    let resolved = false;
    const execution = tracker.handleExecutionStep("BUILD", async () => {
      await Promise.resolve();
      resolved = true;
      return true;
    });

    expect(tracker.getCurrentState()).toBe("INTENT");
    await execution;

    expect(resolved).toBe(true);
    expect(tracker.getCurrentState()).toBe("BUILD");
    expect(changes).toEqual(["BUILD"]);
  });

  it("records failed and rejected execution as FAILED", async () => {
    const changes: string[] = [];
    const tracker = new VibePipelineTracker((state) => changes.push(state));

    await tracker.handleExecutionStep("VERIFY", async () => false);
    expect(tracker.getCurrentState()).toBe("FAILED");

    await tracker.handleExecutionStep("SHIP", async () => {
      throw new Error("runner unavailable");
    });

    expect(changes).toEqual(["FAILED"]);
  });
});

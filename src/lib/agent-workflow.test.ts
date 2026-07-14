import { describe, expect, it } from "vitest";
import {
  agentForJobMode,
  displayWorkflowMode,
  resolveMissionRequest,
} from "./agent-workflow";

describe("agent workflow routing", () => {
  it("uses internal Auto for the public Vibe default", () => {
    const request = resolveMissionRequest("Build the feature");
    expect(request.workflow.agent).toBe("auto");
    expect(request.workflow.jobMode).toBe("auto");
    expect(displayWorkflowMode(request.workflow.jobMode)).toBe("Vibe");
  });

  it("treats the legacy /vibe command as Auto", () => {
    const request = resolveMissionRequest("/vibe fix the app", "researcher");
    expect(request.content).toBe("fix the app");
    expect(request.workflow.agent).toBe("auto");
    expect(request.workflow.jobMode).toBe("auto");
  });

  it("routes a slash command in the same request without stale state", () => {
    const request = resolveMissionRequest("/plan ship safely", "implementer");
    expect(request.content).toBe("ship safely");
    expect(request.workflow.agent).toBe("planner");
    expect(request.workflow.jobMode).toBe("plan");
  });

  it("preserves unknown slash commands as user content", () => {
    const request = resolveMissionRequest("/unknown keep this", "researcher");
    expect(request.command).toBeNull();
    expect(request.content).toBe("/unknown keep this");
    expect(request.workflow.agent).toBe("researcher");
  });

  it("reconstructs the enforced role for durable retries", () => {
    expect(agentForJobMode("auto")).toBe("auto");
    expect(agentForJobMode("vibe")).toBe("auto");
    expect(agentForJobMode("research")).toBe("researcher");
    expect(agentForJobMode("verify")).toBe("tester");
  });
});

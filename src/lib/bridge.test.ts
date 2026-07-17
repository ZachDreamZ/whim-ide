import { describe, expect, it } from "vitest";
import { agentEventsToParts, agentLiveSummary, agentRunEvidence, whimError } from "./bridge";

describe("bridge event boundary", () => {
  it("parses structured native errors without requiring message matching", () => {
    expect(whimError(new Error(" WHIM:WORKSPACE|The selected folder is blocked "))).toEqual({
      code: "WORKSPACE",
      message: "The selected folder is blocked",
    });
    expect(whimError("plain failure")).toEqual({ message: "plain failure" });
    expect(whimError("WHIM_ERROR: WORKSPACE_FILE_CONFLICT - Reload before saving")).toEqual({
      code: "WORKSPACE_FILE_CONFLICT",
      message: "Reload before saving",
    });
  });

  it("renders warning events as advisory, never as a hard failure", () => {
    const parts = agentEventsToParts([
      { type: "warning", code: "POSSIBLE_LOOP", message: "Repeated identical tool calls detected." },
    ]);
    expect(parts).toEqual([
      { type: "warning", code: "POSSIBLE_LOOP", title: "Agent warning", message: "Repeated identical tool calls detected." },
    ]);

    expect(agentLiveSummary({ type: "warning", message: "Advisory iteration budget reached.\u0000" })).toBe(
      "Agent warning: Advisory iteration budget reached.",
    );
  });

  it("renders only recognized, sanitized event shapes", () => {
    const parts = agentEventsToParts([
      { type: "text", text: "hello\u0000\n\n\nworld" },
      { type: "action", command: "do-not-render" },
      {
        type: "tool_use",
        part: {
          id: "call-1",
          tool: "read_file",
          state: { status: "error", input: { path: "README.md" }, error: "Denied" },
        },
      },
    ]);

    expect(parts).toEqual([
      { type: "text", text: "hello   world" },
      {
        type: "tool-Read File",
        toolCallId: "call-1",
        state: "output-error",
        input: { path: "README.md" },
        output: { error: "Denied" },
        errorText: "Denied",
      },
    ]);
  });

  it("derives bounded final counts instead of retaining agent output", () => {
    const evidence = agentRunEvidence({
      durationMs: 420,
      timedOut: true,
      events: [
        { type: "text", text: "secret output is not persisted here" },
        { type: "tool_use", part: { state: { status: "completed" } } },
        { type: "tool_use", part: { state: { status: "error" } } },
      ],
    });

    expect(evidence).toEqual({
      eventCount: 3,
      toolCallCount: 2,
      failedToolCallCount: 1,
      durationMs: 420,
      timedOut: true,
    });
  });

  it("summarizes live progress without exposing raw tool output", () => {
    expect(agentLiveSummary({ type: "progress", message: "Running Verify\u0000\n\n\nnow" })).toBe("Running Verify   now");
    expect(agentLiveSummary({ type: "tool_use", part: { tool: "write_file", state: { status: "completed", output: "API_KEY=secret" } } })).toBe("Completed: Write File");
    expect(agentLiveSummary({ type: "reasoning", part: { text: "hidden chain" } })).toBe("Model reasoning updated.");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { bridge } from "../lib/bridge";
import { AgentChatView, parseAgentEvent } from "./AgentChatView";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("../lib/bridge", () => ({
  bridge: {
    isNative: vi.fn(),
    getChatThread: vi.fn(),
    saveChatThread: vi.fn(),
    runAgent: vi.fn(),
    cancelOperation: vi.fn(),
    createOrchestrationJob: vi.fn(),
    transitionOrchestrationJob: vi.fn(),
    finishOrchestrationJob: vi.fn(),
    getOrchestrationJob: vi.fn(),
  },
  agentRunEvidence: vi.fn(() => ({ eventCount: 0, toolCallCount: 0, failedToolCallCount: 0, durationMs: null, timedOut: false })),
}));

vi.mock("./AgentConversation", () => ({
  AgentConversation: ({ messages, onSend, onStop }: {
    messages: { role: string; parts: { text?: string }[] }[];
    onSend: (content: string) => void;
    onStop: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSend("Review the project")}>Send</button>
      <button type="button" onClick={onStop}>Stop</button>
      {messages.flatMap((message) => message.parts).map((part, index) => <p key={index}>{part.text}</p>)}
    </div>
  ),
}));

const props = {
  workspace: null,
  provider: "auto",
  model: "auto",
};

describe("AgentChatView", () => {
  it("adapts the Rust tool_use event contract into a visible tool timeline part", () => {
    expect(parseAgentEvent({
      type: "tool_use",
      part: {
        id: "write-1",
        tool: "Write",
        state: { status: "completed", input: { path: "src/App.tsx" }, output: "written" },
      },
    })).toMatchObject({
      type: "tool-invocation",
      toolCallId: "write-1",
      toolName: "Write",
      args: { path: "src/App.tsx" },
      result: "written",
    });
  });

  it("marks a failed Rust tool event as failed instead of hiding its error", () => {
    expect(parseAgentEvent({
      type: "tool_use",
      part: { id: "verify-1", tool: "Verify", state: { status: "error", error: "Tests failed" } },
    })).toMatchObject({ type: "tool-invocation", toolName: "Verify", errorText: "Tests failed" });
  });

  it("keeps structured Rust errors understandable in the conversation", () => {
    expect(parseAgentEvent({ type: "error", error: { code: "PROVIDER", message: "Provider unavailable" } }))
      .toMatchObject({ type: "text", text: "Error: Provider unavailable" });
  });

  it("offers a clear deterministic response in browser preview without calling native IPC", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(false);
    render(<AgentChatView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/Preview mode/)).toBeVisible();
    expect(bridge.runAgent).not.toHaveBeenCalled();
  });

  it("loads a durable task selected from the sidebar into the conversation surface", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(true);
    vi.mocked(bridge.getOrchestrationJob).mockResolvedValue({
      job: {
        id: "job-42",
        workspace: "C:/workspace",
        title: "Repair checks",
        intent: "Fix failing checks",
        mode: "build",
        risk: "low",
        status: "failed",
        budget: { maxDurationMs: 600000, maxToolIterations: 100, maxAttempts: 3 },
        operationId: null,
        operationIds: [],
        provider: null,
        model: null,
        createdAtMs: 1,
        updatedAtMs: 2,
        startedAtMs: null,
        finishedAtMs: null,
        summary: "Typecheck failed.",
        evidence: { eventCount: 2, toolCallCount: 1, failedToolCallCount: 1, durationMs: null, timedOut: false },
        eventCount: 2,
        attempt: 2,
        nextEligibleAtMs: null,
      },
      events: [],
    });

    render(<AgentChatView {...props} workspace="C:/workspace" initialJobId="job-42" />);

    expect(await screen.findByText(/Task loaded: Repair checks/)).toBeVisible();
    expect(screen.getByText(/Status: Failed/)).toBeVisible();
    expect(bridge.getOrchestrationJob).toHaveBeenCalledWith("C:/workspace", "job-42");
  });

  it("renders a resolved native failure as a retryable conversation error", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(true);
    const job = { id: "job-1", workspace: "", status: "running" };
    vi.mocked(bridge.createOrchestrationJob).mockResolvedValue(job as never);
    vi.mocked(bridge.transitionOrchestrationJob).mockResolvedValue(job as never);
    vi.mocked(bridge.finishOrchestrationJob).mockResolvedValue(job as never);
    vi.mocked(bridge.runAgent).mockResolvedValue({
      success: false,
      stderr: "Provider connection failed",
      events: [],
    });
    render(<AgentChatView {...props} workspace="C:/workspace" />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Error: Provider connection failed")).toBeVisible();
    expect(bridge.createOrchestrationJob).toHaveBeenCalledWith(expect.objectContaining({ workspace: "C:/workspace", mode: "auto" }));
    expect(bridge.finishOrchestrationJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1", outcome: "failed" }));
    expect(bridge.runAgent).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Closed-loop execution contract"),
    }));
  });
});

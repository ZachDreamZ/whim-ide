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
  },
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

    expect(await screen.findByText(/Browser preview response/)).toBeVisible();
    expect(bridge.runAgent).not.toHaveBeenCalled();
  });

  it("renders a resolved native failure as a retryable conversation error", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(true);
    vi.mocked(bridge.runAgent).mockResolvedValue({
      success: false,
      stderr: "Provider connection failed",
      events: [],
    });
    render(<AgentChatView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Error: Provider connection failed")).toBeVisible();
  });
});

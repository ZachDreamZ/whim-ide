import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bridge } from "../lib/bridge";
import { ChatHub } from "./ChatHub";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./ui/VoiceOrb", () => ({ VoiceOrb: () => <div data-testid="voice-orb" /> }));
vi.mock("./agent-elements/agent-chat", () => ({
  AgentChat: ({ onSend, messages, greeting }: { onSend: (message: { role: "user"; content: string }) => void; messages: unknown[]; greeting: ReactNode }) => <div>
    {messages.length === 0 && greeting}
    <span data-testid="message-count">{messages.length}</span>
    <button type="button" onClick={() => void onSend({ role: "user", content: "Hello from Chat" })}>Send test chat</button>
  </div>,
}));
vi.mock("../lib/bridge", () => ({
  bridge: {
    isNative: vi.fn(), listChatThreads: vi.fn(), getChatThread: vi.fn(), saveChatThread: vi.fn(),
    deleteChatThread: vi.fn(), cancelOperation: vi.fn(), runAgent: vi.fn(), readFileContent: vi.fn(), openGptSection: vi.fn(),
  },
  agentEventsToParts: vi.fn(),
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
}));

describe("ChatHub", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(bridge.isNative).mockReturnValue(true);
    vi.mocked(bridge.listChatThreads).mockResolvedValue([]);
    vi.mocked(bridge.saveChatThread).mockImplementation(async (thread) => thread);
    vi.mocked(bridge.runAgent).mockResolvedValue({ success: true, exitCode: 0, stdout: "Hello back", stderr: "", durationMs: 8, cancelled: false, timedOut: false, events: [] });
    const { agentEventsToParts } = await import("../lib/bridge");
    vi.mocked(agentEventsToParts).mockReturnValue([{ type: "text", text: "Hello back" }]);
  });

  it("runs a workspace-free tool-less Chat and persists both messages", async () => {
    render(<ChatHub workspace={null} provider="local" model="auto" models={[]} onModelChange={vi.fn()} hasProvider onOpenProviders={vi.fn()} voice="alloy" voiceLanguage="auto" voiceDictionary="Whim, Tauri" enterToSend showCopyActions persistHistory />);
    expect(await screen.findByText("Ask quick questions with Chat")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Send test chat" }));

    await waitFor(() => expect(bridge.runAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: "chat", provider: "local", prompt: expect.stringContaining("Current user message:\nHello from Chat") })));
    expect(vi.mocked(bridge.runAgent).mock.calls[0]?.[0]).not.toHaveProperty("workspace");
    await waitFor(() => expect(bridge.saveChatThread).toHaveBeenCalledTimes(2));
    const saveCalls = vi.mocked(bridge.saveChatThread).mock.calls;
    const saved = saveCalls[saveCalls.length - 1]?.[0];
    expect(saved?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(saved?.messages[1]?.content).toBe("Hello back");
  });
});

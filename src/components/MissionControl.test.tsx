import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { attachmentPathIsSensitive, localPreviewUrlFromEvent, MissionControl, workspaceRelativeAttachmentPath } from "./MissionControl";

vi.mock("./agent-elements/agent-chat", () => ({
  AgentChat: () => <div data-testid="agent-chat" />,
}));
vi.mock("./ContextIndexCard", () => ({
  ContextIndexCard: () => <div data-testid="context-index" />,
}));
vi.mock("./IntentBriefCard", () => ({
  IntentBriefCard: () => <div data-testid="intent-brief" />,
}));
vi.mock("./TaskLedger", () => ({
  TaskLedger: () => <div data-testid="task-ledger" />,
}));
vi.mock("./VerificationCard", () => ({
  VerificationCard: () => <div data-testid="verification-card" />,
}));
vi.mock("./WorktreeCard", () => ({
  WorktreeCard: () => <div data-testid="worktree-card" />,
}));
vi.mock("../lib/bridge", () => ({
  bridge: { isNative: () => false },
  agentEventsToParts: () => [],
  agentLiveSummary: () => null,
  agentRunEvidence: () => ({ eventCount: 0, toolCallCount: 0, failedToolCallCount: 0, durationMs: null, timedOut: false }),
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
}));

describe("MissionControl mode selector", () => {
  it("toggles between auto and vibe mode via the role trigger button", () => {
    render(
      <MissionControl
        workspace={null}
        workspaceEntries={[]}
        model="auto"
        models={[]}
        onModelChange={vi.fn()}
        hasProvider
        onOpenProviders={vi.fn()}
        provider="local"
      />,
    );

    // Default mode is "auto" — button shows "Whim Auto"
    const trigger = screen.getByRole("button", { name: "Whim Auto" });
    expect(trigger).toBeVisible();

    // Click toggles to "vibe"
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Whim Vibe" })).toBeVisible();
  });
});

describe("MissionControl workspace attachments", () => {
  it("accepts only descendants of the active workspace", () => {
    expect(workspaceRelativeAttachmentPath("C:\\repo", "C:\\repo\\src\\main.ts")).toBe("src/main.ts");
    expect(workspaceRelativeAttachmentPath("C:\\repo", "C:\\repo-other\\main.ts")).toBeNull();
    expect(workspaceRelativeAttachmentPath("C:\\repo", "C:\\outside\\main.ts")).toBeNull();
  });

  it("blocks credential-shaped attachment paths", () => {
    expect(attachmentPathIsSensitive(".env.local")).toBe(true);
    expect(attachmentPathIsSensitive(".pi/agent/auth.json")).toBe(true);
    expect(attachmentPathIsSensitive("src/id_ed25519")).toBe(true);
    expect(attachmentPathIsSensitive("src/config.ts")).toBe(false);
  });
});

describe("MissionControl local preview evidence", () => {
  it("accepts only reported loopback HTTP URLs", () => {
    expect(localPreviewUrlFromEvent({ output: "Ready at http://localhost:3000" })).toBe("http://localhost:3000");
    expect(localPreviewUrlFromEvent({ output: "Ready at http://127.0.0.1:1420/path" })).toBe("http://127.0.0.1:1420");
    expect(localPreviewUrlFromEvent({ output: "https://public.example.com" })).toBeNull();
  });
});

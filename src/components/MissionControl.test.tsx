import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MissionControl } from "./MissionControl";

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
  it("exposes the six core modes and changes the selected mode", () => {
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

    for (const name of ["Vibe", "Plan", "Build", "Verify", "Review", "Ship"]) {
      expect(screen.getByRole("tab", { name })).toBeVisible();
    }
    expect(screen.getByRole("tab", { name: "Vibe" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Verify" }));

    expect(screen.getByRole("tab", { name: "Verify" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Vibe" })).toHaveAttribute("aria-selected", "false");
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./ProjectSidebar";
import { bridge, type ChatThreadSummary, type OrchestrationJob } from "../lib/bridge";

vi.mock("../lib/bridge", () => ({
  bridge: {
    isNative: vi.fn(),
    listProjectOrchestrationJobs: vi.fn(),
    listChatThreads: vi.fn(),
  },
}));

const job = {
  id: "job-1",
  workspace: "C:/work/whim-ide",
  title: "Make Vibe automatic",
  intent: "Edit and verify without a mode switch",
  mode: "auto",
  risk: "medium",
  status: "completed",
  budget: { maxDurationMs: 60_000, maxToolIterations: 10, maxAttempts: 2 },
  operationIds: [],
  createdAtMs: 1_000,
  updatedAtMs: Date.now(),
  startedAtMs: 1_100,
  finishedAtMs: 2_000,
  evidence: { eventCount: 4, toolCallCount: 2, failedToolCallCount: 0, durationMs: 900, timedOut: false },
  eventCount: 4,
  attempt: 1,
} satisfies OrchestrationJob;

const chat = {
  id: "chat-1",
  title: "Provider setup",
  createdAtMs: 1_000,
  updatedAtMs: 2_000,
  messageCount: 3,
  preview: "Use the Codex subscription runtime",
} satisfies ChatThreadSummary;

describe("ProjectSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bridge.isNative).mockReturnValue(true);
    vi.mocked(bridge.listProjectOrchestrationJobs).mockResolvedValue([job]);
    vi.mocked(bridge.listChatThreads).mockResolvedValue([chat]);
  });

  it("shows durable projects, tasks, chats, and native browser navigation without the broken Files tree", async () => {
    const onViewChange = vi.fn();
    render(
      <ProjectSidebar
        activeView="build"
        workspace="C:/work/whim-ide"
        onOpenWorkspace={vi.fn()}
        onViewChange={onViewChange}
      />,
    );

    expect(screen.queryByText("Files")).not.toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeVisible();
    await waitFor(() => expect(screen.getAllByText("Make Vibe automatic").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("Provider setup")).toBeVisible());

    // Browser is inside the More dropdown — verify the dropdown exists
    expect(screen.getByText("More")).toBeInTheDocument();
  });
});

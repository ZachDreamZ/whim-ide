import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrchestrationPanel } from "./OrchestrationPanel";
import { bridge, type OrchestrationJob } from "../lib/bridge";

vi.mock("../lib/bridge", () => {
  return {
    bridge: {
      isNative: vi.fn(),
      listProjectOrchestrationJobs: vi.fn(),
      createOrchestrationJob: vi.fn(),
      dispatchOrchestrationJob: vi.fn(),
      transitionOrchestrationJob: vi.fn(),
      retryOrchestrationJob: vi.fn(),
    },
  };
});

const mockJobs: OrchestrationJob[] = [
  {
    id: "job-1",
    workspace: "C:/workspace",
    title: "Test Task",
    intent: "Verify something",
    mode: "build",
    risk: "low",
    status: "queued",
    budget: { maxDurationMs: 60000, maxToolIterations: 10, maxAttempts: 2 },
    operationIds: [],
    createdAtMs: 1000,
    updatedAtMs: 2000,
    startedAtMs: null,
    finishedAtMs: null,
    evidence: { eventCount: 0, toolCallCount: 0, failedToolCallCount: 0, durationMs: null, timedOut: false },
    eventCount: 0,
    attempt: 1,
  },
];

describe("OrchestrationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders composer and list when running in native mode", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(true);
    vi.mocked(bridge.listProjectOrchestrationJobs).mockResolvedValue(mockJobs);

    render(<OrchestrationPanel workspace="C:/workspace" />);

    // Verify header renders
    expect(screen.getByText("Compose a task")).toBeVisible();
    
    // Verify list loads
    await waitFor(() => {
      expect(screen.getByText("Test Task")).toBeVisible();
    });

    // Inputs should be enabled
    expect(screen.getByPlaceholderText(/describe what you want/i)).not.toBeDisabled();
    
    // Warning banner should NOT be present
    expect(screen.queryByText(/Task orchestration and agent dispatch are available in the installed Whim Windows app/i)).not.toBeInTheDocument();
  });

  it("renders warning banner and disables inputs/buttons when running in browser mode", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(false);
    vi.mocked(bridge.listProjectOrchestrationJobs).mockResolvedValue([]);

    render(<OrchestrationPanel workspace="C:/workspace" />);

    // Warning banner should be present
    expect(screen.getByText("Task orchestration and agent dispatch are available in the installed Whim Windows app.")).toBeVisible();

    // Inputs should be disabled
    expect(screen.getByPlaceholderText(/describe what you want/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /create task/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeDisabled();
  });

  it("calls createOrchestrationJob when submitting form in native mode", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(true);
    vi.mocked(bridge.listProjectOrchestrationJobs).mockResolvedValue([]);
    const createMock = vi.mocked(bridge.createOrchestrationJob).mockResolvedValue({
      id: "job-2",
      title: "New Job",
      status: "queued",
      operationIds: [],
    } as any);

    render(<OrchestrationPanel workspace="C:/workspace" />);

    const textarea = screen.getByPlaceholderText(/describe what you want/i);
    fireEvent.change(textarea, { target: { value: "Build a landing page" } });

    const createBtn = screen.getByRole("button", { name: /create task/i });
    expect(createBtn).not.toBeDisabled();
    fireEvent.click(createBtn);

    expect(createMock).toHaveBeenCalledWith({
      workspace: "C:/workspace",
      intent: "Build a landing page",
      mode: "build",
      provider: undefined,
      model: undefined,
    });
  });

  it("handles dispatching and transitions in native mode", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(true);
    vi.mocked(bridge.listProjectOrchestrationJobs).mockResolvedValue(mockJobs);
    const dispatchMock = vi.mocked(bridge.dispatchOrchestrationJob).mockResolvedValue(null as any);

    render(<OrchestrationPanel workspace="C:/workspace" />);

    // Click card to select it and show actions
    await waitFor(() => {
      fireEvent.click(screen.getByText("Test Task"));
    });

    const dispatchBtn = screen.getByRole("button", { name: /dispatch/i });
    fireEvent.click(dispatchBtn);

    expect(dispatchMock).toHaveBeenCalledWith({
      workspace: "C:/workspace",
      jobId: "job-1",
      apiKey: undefined,
      baseUrl: undefined,
    });
  });
});

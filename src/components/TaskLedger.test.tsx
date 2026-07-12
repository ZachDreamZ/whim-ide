import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrchestrationJob, OrchestrationJobDetail } from "../lib/bridge";
import { TaskLedger } from "./TaskLedger";

const job: OrchestrationJob = {
  id: "8f209af3-0434-4bd6-8290-9ee7d2b5f151",
  workspace: "C:/work/whim",
  title: "Build the task ledger",
  intent: "Persist a reviewable native task before the agent runs.",
  mode: "build",
  risk: "medium",
  status: "completed",
  budget: { maxDurationMs: 600_000, maxToolIterations: 18, maxAttempts: 3 },
  operationIds: [],
  createdAtMs: 1_700_000_000_000,
  updatedAtMs: 1_700_000_001_000,
  startedAtMs: 1_700_000_000_100,
  finishedAtMs: 1_700_000_001_000,
  evidence: {
    eventCount: 2,
    toolCallCount: 1,
    failedToolCallCount: 0,
    durationMs: 900,
    timedOut: false,
  },
  eventCount: 2,
  attempt: 1,
};

const detail: OrchestrationJobDetail = {
  job,
  events: [
    {
      id: "event-1",
      atMs: 1_700_000_001_000,
      actor: "system",
      kind: "completed",
      message: "Verification passed and the task was completed.",
    },
  ],
};

describe("TaskLedger", () => {
  it("does not simulate persistent tasks in a browser preview", () => {
    render(
      <TaskLedger
        native={false}
        jobs={[]}
        activeJob={null}
        detail={null}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Task persistence is available in the installed Windows app.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh task ledger" })).toBeDisabled();
  });

  it("shows auditable task evidence only after the user opens the task", () => {
    const onSelect = vi.fn();
    render(
      <TaskLedger
        native
        jobs={[job]}
        activeJob={job}
        detail={detail}
        onRefresh={vi.fn()}
        onSelect={onSelect}
      />,
    );

    expect(screen.queryByText("Verification passed and the task was completed.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /build the task ledger/i }));

    expect(onSelect).toHaveBeenCalledWith(job);
    expect(screen.getByText("Persist a reviewable native task before the agent runs.")).toBeVisible();
    expect(screen.getByText("Verification passed and the task was completed.")).toBeVisible();
    expect(screen.getByText(/attempt 1\/3/i)).toBeVisible();
  });

  it("shows a bounded durable activity count while a native task is still running", () => {
    const running: OrchestrationJob = {
      ...job,
      status: "running",
      finishedAtMs: null,
      evidence: { eventCount: 0, toolCallCount: 0, failedToolCallCount: 0, durationMs: null, timedOut: false },
      eventCount: 4,
    };
    const runningDetail: OrchestrationJobDetail = {
      job: running,
      events: [
        { id: "created", atMs: 1_700_000_000_000, actor: "user", kind: "created", message: "Task queued." },
        { id: "started", atMs: 1_700_000_000_100, actor: "user", kind: "started", message: "Task started." },
        { id: "tool-1", atMs: 1_700_000_000_200, actor: "agent", kind: "evidence", message: "Completed: workspace file read." },
        { id: "tool-2", atMs: 1_700_000_000_300, actor: "agent", kind: "evidence", message: "Completed: workspace file edit." },
      ],
    };

    render(
      <TaskLedger
        native
        jobs={[running]}
        activeJob={running}
        detail={runningDetail}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /build the task ledger/i }));
    expect(screen.getByText("2 durable actions recorded")).toBeVisible();
    expect(screen.getByText("Completed: workspace file edit.")).toBeVisible();
    expect(screen.getByText(/durable trail stores fixed, redacted activity labels/i)).toBeVisible();
  });

  it("shows the target writer slot and queued roster without claiming parallel writes", () => {
    const running = { ...job, status: "running" as const, finishedAtMs: null };
    const queued = {
      ...job,
      id: "70473a6a-f909-44db-a1d2-8ed94c74958a",
      title: "Queued verifier",
      status: "queued" as const,
      startedAtMs: null,
      finishedAtMs: null,
    };
    render(
      <TaskLedger
        native
        jobs={[running, queued]}
        activeJob={running}
        detail={null}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Execution target roster")).toHaveTextContent("1 execution target");
    expect(screen.getByLabelText("Execution target roster")).toHaveTextContent("1/1 running · 1 queued");
  });

  it("offers an explicit bounded retry only for an eligible failed attempt", () => {
    const failed = { ...job, status: "failed" as const, attempt: 1 };
    const onRetry = vi.fn();
    const { rerender } = render(
      <TaskLedger
        native
        jobs={[failed]}
        activeJob={failed}
        detail={{ ...detail, job: failed }}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /build the task ledger/i }));
    fireEvent.click(screen.getByRole("button", { name: "Retry attempt 2" }));
    expect(onRetry).toHaveBeenCalledWith(failed);

    const exhausted = { ...failed, attempt: 3 };
    rerender(
      <TaskLedger
        native
        jobs={[exhausted]}
        activeJob={exhausted}
        detail={{ ...detail, job: exhausted }}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole("button", { name: /retry attempt/i })).not.toBeInTheDocument();
  });

  it("can explicitly resume a durable queued retry after an app restart", () => {
    const queued = {
      ...job,
      status: "queued" as const,
      attempt: 2,
      operationId: "c20a97fc-721f-4c5a-93c3-42ca1e12a5f2",
      operationIds: ["first-attempt", "c20a97fc-721f-4c5a-93c3-42ca1e12a5f2"],
      startedAtMs: null,
      finishedAtMs: null,
    };
    const onResume = vi.fn();
    const onBackground = vi.fn();
    render(
      <TaskLedger
        native
        jobs={[queued]}
        activeJob={queued}
        detail={{ ...detail, job: queued }}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
        onResume={onResume}
        onBackground={onBackground}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /build the task ledger/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run queued attempt 2" }));
    expect(onResume).toHaveBeenCalledWith(queued);
    fireEvent.click(screen.getByRole("button", { name: "Run in background" }));
    expect(onBackground).toHaveBeenCalledWith(queued);
  });

  it("exposes cancellation for a running background-capable task", () => {
    const running = {
      ...job,
      status: "running" as const,
      operationId: "a8785f21-358e-4aaa-b002-f88cd6a3df79",
      operationIds: ["a8785f21-358e-4aaa-b002-f88cd6a3df79"],
      finishedAtMs: null,
    };
    const onCancel = vi.fn();
    render(
      <TaskLedger
        native
        jobs={[running]}
        activeJob={running}
        detail={{ ...detail, job: running }}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /build the task ledger/i }));
    fireEvent.click(screen.getByRole("button", { name: "Stop background task" }));
    expect(onCancel).toHaveBeenCalledWith(running);
  });
});

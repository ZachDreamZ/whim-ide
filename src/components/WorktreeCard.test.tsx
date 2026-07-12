import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorktreeCard } from "./WorktreeCard";

const { listGitWorktrees, createGitWorktree, inspectWorktreeCandidate } = vi.hoisted(() => ({
  listGitWorktrees: vi.fn(),
  createGitWorktree: vi.fn(),
  inspectWorktreeCandidate: vi.fn(),
}));

vi.mock("../lib/bridge", () => ({
  bridge: { listGitWorktrees, createGitWorktree, inspectWorktreeCandidate },
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
}));

describe("WorktreeCard", () => {
  beforeEach(() => {
    listGitWorktrees.mockReset();
    createGitWorktree.mockReset();
    inspectWorktreeCandidate.mockReset();
  });

  it("renders a bounded read-only candidate report from native Git evidence", async () => {
    const primary = "C:/work/whim";
    const isolated = "C:/work/.whim-worktrees/whim/review-123";
    listGitWorktrees.mockResolvedValue([
      { path: primary, branch: "main", head: "aaaaaaaa", detached: false, primary: true, managed: false },
      { path: isolated, branch: "whim/review-123", head: "bbbbbbbb", detached: false, primary: false, managed: true },
    ]);
    inspectWorktreeCandidate.mockResolvedValue({
      baseWorkspace: primary,
      candidateWorkspace: isolated,
      baseHead: "aaaaaaaa11111111",
      candidateHead: "bbbbbbbb22222222",
      mergeBase: "cccccccc33333333",
      branch: "whim/review-123",
      committedChangeCount: 2,
      workingChangeCount: 1,
      changes: [{ path: "src/auth.ts", status: "M", source: "committed" }],
      changesTruncated: false,
      risk: "high",
      riskSignals: ["Authentication or authorization files changed"],
      blockers: ["Candidate has uncommitted changes; review and commit or discard them before merge."],
      verificationChecks: [{ id: "typecheck", label: "Typecheck", command: "npm run typecheck", source: "package.json", tier: "core", timeoutMs: 120000 }],
      verificationWarnings: [],
    });

    render(
      <WorktreeCard
        native
        workspace={primary}
        executionWorkspace={isolated}
        onExecutionWorkspaceChange={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Inspect candidate" }));
    await waitFor(() => expect(inspectWorktreeCandidate).toHaveBeenCalledWith(isolated));
    expect(screen.getByLabelText("Candidate review report")).toHaveTextContent("high risk");
    expect(screen.getByLabelText("Candidate review report")).toHaveTextContent("2 committed · 1 working · 1 checks found");
    expect(screen.getByText(/candidate has uncommitted changes/i)).toBeVisible();
    expect(screen.getByText("src/auth.ts")).toBeVisible();
  });

  it("does not simulate isolated execution in browser preview", () => {
    render(
      <WorktreeCard
        native={false}
        workspace="C:/work/whim"
        executionWorkspace="C:/work/whim"
        onExecutionWorkspaceChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Isolated execution is available in the installed Windows app.")).toBeVisible();
    expect(listGitWorktrees).not.toHaveBeenCalled();
  });

  it("uses Git-reported worktrees as execution targets and creates a named branch", async () => {
    const primary = "C:/work/whim";
    const isolated = "C:/work/.whim-worktrees/whim/review-123";
    const onExecutionWorkspaceChange = vi.fn();
    listGitWorktrees.mockResolvedValue([
      { path: primary, branch: "main", head: "aaa", detached: false, primary: true, managed: false },
      { path: isolated, branch: "whim/review-123", head: "aaa", detached: false, primary: false, managed: true },
    ]);
    createGitWorktree.mockResolvedValue({
      path: isolated,
      branch: "whim/review-123",
      head: "aaa",
      detached: false,
      primary: false,
      managed: true,
    });

    render(
      <WorktreeCard
        native
        workspace={primary}
        executionWorkspace={primary}
        onExecutionWorkspaceChange={onExecutionWorkspaceChange}
      />,
    );

    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("whim/review-123"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: isolated } });
    expect(onExecutionWorkspaceChange).toHaveBeenCalledWith(isolated);

    fireEvent.change(screen.getByRole("textbox", { name: "New isolated worktree name" }), { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: /create isolated git worktree/i }));
    await waitFor(() => expect(createGitWorktree).toHaveBeenCalledWith({ name: "review" }));
    expect(onExecutionWorkspaceChange).toHaveBeenCalledWith(isolated);
  });
});

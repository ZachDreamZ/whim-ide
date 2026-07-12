import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VerificationCard } from "./VerificationCard";

const { verificationPlan, runCommand, cancelOperation } = vi.hoisted(() => ({
  verificationPlan: vi.fn(),
  runCommand: vi.fn(),
  cancelOperation: vi.fn(),
}));

vi.mock("../lib/bridge", () => ({
  bridge: { verificationPlan, runCommand, cancelOperation },
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
}));

describe("VerificationCard", () => {
  beforeEach(() => {
    verificationPlan.mockReset();
    runCommand.mockReset();
    cancelOperation.mockReset();
  });

  it("does not fabricate verification results in browser preview", () => {
    render(<VerificationCard native={false} workspace="C:/work/whim" />);

    expect(screen.getByText("Real checks are available in the installed Windows app.")).toBeVisible();
    expect(verificationPlan).not.toHaveBeenCalled();
  });

  it("runs only an explicit, native-discovered check and shows its evidence", async () => {
    const workspace = "C:/work/whim";
    const onRunComplete = vi.fn();
    verificationPlan.mockResolvedValue({
      workspace,
      warnings: [],
      checks: [{
        id: "node-test",
        label: "Tests",
        command: "npm run test",
        source: "package.json",
        tier: "core",
        timeoutMs: 300_000,
      }],
    });
    runCommand.mockResolvedValue({ success: true, stdout: "22 tests passed", durationMs: 420 });

    render(<VerificationCard native workspace={workspace} onRunComplete={onRunComplete} />);

    await waitFor(() => expect(screen.getByText("npm run test")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Run core" }));

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith(
      workspace,
      "npm run test",
      expect.objectContaining({ timeoutMs: 300_000 }),
    ));
    expect(screen.getByText("passed")).toBeVisible();
    expect(screen.getByText("Evidence")).toBeVisible();
    expect(onRunComplete).toHaveBeenCalledTimes(1);
  });
});

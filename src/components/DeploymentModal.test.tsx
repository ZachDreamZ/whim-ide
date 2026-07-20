import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentModal } from "./DeploymentModal";

const deploy = vi.fn();
const deployPreflight = vi.fn();

vi.mock("../lib/bridge", () => ({
  bridge: { deploy: (...args: unknown[]) => deploy(...args), deployPreflight: (...args: unknown[]) => deployPreflight(...args) },
  errorMessage: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
}));

describe("DeploymentModal", () => {
  beforeEach(() => {
    deploy.mockReset();
    deployPreflight.mockReset();
  });

  it("requires explicit production-impact confirmation", async () => {
    deployPreflight.mockResolvedValue({ success: true });
    render(<DeploymentModal workspace={"C:\\workspace"} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /production/i }));
    expect(screen.getByRole("button", { name: /deploy to production/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /deploy to production/i })).toBeEnabled();
  });

  it("passes the selected workspace and never fabricates a deployment URL", async () => {
    deploy.mockResolvedValue({ success: true, stdout: "Deployment complete", stderr: "" });
    deployPreflight.mockResolvedValue({ success: true });
    render(<DeploymentModal workspace={"C:\\workspace"} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /deploy to preview/i }));

    await waitFor(() => expect(deploy).toHaveBeenCalledWith("C:\\workspace", "vercel", false, false));
    expect(await screen.findByText(/no public url/i)).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

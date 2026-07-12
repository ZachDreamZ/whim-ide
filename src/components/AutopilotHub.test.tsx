import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AutopilotHub } from "./AutopilotHub";
import { bridge } from "../lib/bridge";

vi.mock("../lib/bridge", () => {
  return {
    bridge: {
      isNative: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      environment: vi.fn(),
    },
  };
});

const mockEnv = {
  platform: "Windows",
  tools: [
    { id: "git", name: "Git", installed: true, version: "2.40.0" },
    { id: "docker", name: "Docker", installed: false },
  ],
};

describe("AutopilotHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders warning banner and disables options when running in browser mode", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(false);

    render(
      <AutopilotHub
        workspace="C:/workspace"
        environment={mockEnv}
        onOpenFile={vi.fn()}
      />,
    );

    // Warning notice should be visible
    expect(screen.getByText("Automation policies and PC environment discovery are available in the installed Whim Windows app.")).toBeVisible();

    // Controls should be disabled
    expect(screen.getByRole("button", { name: /pause optional/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /enforce validation/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /restore defaults/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /open policy file/i })).toBeDisabled();
  });
});

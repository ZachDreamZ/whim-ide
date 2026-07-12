import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipHub } from "./ShipHub";
import { bridge } from "../lib/bridge";

vi.mock("../lib/bridge", () => {
  return {
    bridge: {
      isNative: vi.fn(),
      deployPreflight: vi.fn(),
      deploy: vi.fn(),
      runCommand: vi.fn(),
    },
  };
});

describe("ShipHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders warning notice and disables buttons when running in browser mode", () => {
    vi.mocked(bridge.isNative).mockReturnValue(false);

    render(<ShipHub workspace="C:/workspace" />);

    // Warning notice should be visible
    expect(screen.getByText("Workspace deployment and preflight checks are available in the installed Whim Windows app.")).toBeVisible();

    // Prepare preview and diff buttons should be disabled
    expect(screen.getByRole("button", { name: /prepare private preview/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /review release diff/i })).toBeDisabled();

    // Console actions should be disabled
    expect(screen.getByRole("button", { name: /recheck/i })).toBeDisabled();
    
    // Production deploy button should be disabled
    expect(screen.getByRole("button", { name: /deploy to production/i })).toBeDisabled();
  });
});

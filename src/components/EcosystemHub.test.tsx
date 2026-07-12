import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EcosystemHub } from "./EcosystemHub";
import { bridge } from "../lib/bridge";

vi.mock("../lib/bridge", () => {
  return {
    bridge: {
      isNative: vi.fn(),
      readWhimConfig: vi.fn(),
      writeWhimConfig: vi.fn(),
    },
  };
});

describe("EcosystemHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders warning notice and disables integrations list additions in browser mode", async () => {
    vi.mocked(bridge.isNative).mockReturnValue(false);

    render(<EcosystemHub workspace="C:/workspace" />);

    // Warning notice should be visible
    expect(screen.getByText("MCP server integration and plugins are available in the installed Whim Windows app.")).toBeVisible();

    // Add custom integration card/button should be disabled
    expect(screen.getByRole("button", { name: /add a custom integration/i })).toBeDisabled();

    // Toolbar refresh should be disabled
    expect(screen.getByRole("button", { name: /refresh/i })).toBeDisabled();

    // Integration add buttons should be disabled
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /add to workspace/i })[0]).toBeDisabled();
    });
  });
});

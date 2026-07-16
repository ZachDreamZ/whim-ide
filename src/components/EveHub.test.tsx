import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bridge, type EveProjectStatus } from "../lib/bridge";
import { EveHub } from "./EveHub";

vi.mock("../lib/bridge", () => ({
  bridge: {
    isNative: vi.fn(),
    inspectEveWorkspace: vi.fn(),
    validateEveWorkspace: vi.fn(),
  },
}));

const status: EveProjectStatus = {
  detected: true,
  layout: "nested",
  packageVersion: "^0.24.4",
  cliAvailable: true,
  cliPath: "C:/repo/node_modules/.bin/eve.cmd",
  instructionsPath: "agent/instructions.md",
  skills: ["agent/skills/release.md"],
  tools: ["agent/tools/check.ts"],
  channels: ["agent/channels/eve.ts"],
  schedules: [],
  evals: ["evals/agent.eval.ts"],
};

describe("EveHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bridge.isNative).mockReturnValue(true);
    vi.mocked(bridge.inspectEveWorkspace).mockResolvedValue(status);
    vi.mocked(bridge.validateEveWorkspace).mockResolvedValue({ ...status, compileStatus: "ready", diagnosticErrors: 0, diagnosticWarnings: 0 });
  });

  it("surfaces the filesystem contract and opens instructions", async () => {
    const onOpenFile = vi.fn();
    render(<EveHub workspace="C:/repo" onOpenFile={onOpenFile} />);
    expect(await screen.findByText("eve ^0.24.4")).toBeVisible();
    expect(screen.getByText("agent/skills/release.md")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenFile).toHaveBeenCalledWith("agent/instructions.md");
  });

  it("runs project validation only after an explicit button click", async () => {
    render(<EveHub workspace="C:/repo" onOpenFile={vi.fn()} />);
    const button = await screen.findByRole("button", { name: /run eve info/i });
    expect(bridge.validateEveWorkspace).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(bridge.validateEveWorkspace).toHaveBeenCalledWith("C:/repo"));
    expect(await screen.findByText("ready")).toBeVisible();
  });
});

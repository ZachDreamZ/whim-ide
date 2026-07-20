import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreativeStudio } from "./CreativeStudio";

const { mediaRuntimeStatus, generateMedia } = vi.hoisted(() => ({
  mediaRuntimeStatus: vi.fn(),
  generateMedia: vi.fn(),
}));

vi.mock("../lib/bridge", () => ({
  bridge: {
    mediaRuntimeStatus,
    generateMedia,
    readMediaArtifact: vi.fn(),
    reveal: vi.fn(),
  },
}));

describe("CreativeStudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaRuntimeStatus.mockResolvedValue({
      codexAvailable: true,
      codexAuthenticated: true,
      codexAuthKind: "ChatGPT subscription",
      ffmpegAvailable: true,
      windowsVoiceAvailable: true,
    });
    generateMedia.mockResolvedValue({
      id: "media-1",
      mode: "image",
      title: "Campaign visual",
      summary: "Image created",
      outputDirectory: ".whim/media/media-1",
      artifacts: [],
    });
  });

  it("sends an image request to the native media boundary", async () => {
    render(<CreativeStudio workspace={"C:\\workspace"} />);

    await waitFor(() => expect(screen.getByText("Codex CLI")).toBeVisible());
    fireEvent.change(screen.getByPlaceholderText(/Describe the subject/), {
      target: { value: "Original creator-style product photo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate image" }));

    await waitFor(() => expect(generateMedia).toHaveBeenCalledTimes(1));
    expect(generateMedia).toHaveBeenCalledWith(expect.objectContaining({
      workspace: "C:\\workspace",
      mode: "image",
      prompt: "Original creator-style product photo",
      aspectRatio: "9:16",
    }));
    expect(await screen.findByRole("heading", { name: "Campaign visual" })).toBeVisible();
  });

  it("exposes the full local UGC pipeline only when every runtime is ready", async () => {
    render(<CreativeStudio workspace={"C:\\workspace"} />);

    fireEvent.click(screen.getByRole("tab", { name: "UGC video" }));
    await waitFor(() => expect(screen.getByText("FFmpeg renderer")).toBeVisible());
    expect(screen.getByText("Windows voice")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create UGC video" })).toBeDisabled();
  });
});

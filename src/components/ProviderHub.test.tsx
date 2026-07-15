import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bridge, type DiscoveredProvider } from "../lib/bridge";
import { displayModelChoice, isProviderReady, ProviderHub } from "./ProviderHub";

const google: DiscoveredProvider = {
  provider: "google",
  label: "Google Gemini",
  kind: "cloud",
  available: true,
  hasKey: true,
  baseUrl: null,
  note: null,
  capabilities: { chat: true, speechToText: false, textToSpeech: false },
};

const openai: DiscoveredProvider = {
  ...google,
  provider: "openai",
  label: "OpenAI",
};

const baseProps = {
  onRefresh: vi.fn(),
  agentApiKey: "",
  agentBaseUrl: "",
  agentModel: "",
  onAgentProfileChange: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe("displayModelChoice", () => {
  it("keeps Auto internal and presents it as Vibe", () => {
    expect(displayModelChoice("auto")).toBe("Vibe (agent chooses)");
    expect(displayModelChoice("gpt-5.4")).toBe("gpt-5.4");
  });

  it("does not count an unavailable keyless runtime as ready", () => {
    const unavailableLocal: DiscoveredProvider = {
      ...google,
      provider: "local",
      label: "Local",
      kind: "local",
      available: false,
      hasKey: true,
    };
    expect(isProviderReady(unavailableLocal)).toBe(false);
    expect(isProviderReady(google)).toBe(true);
  });

  it("loads models for a native environment credential without receiving its value", async () => {
    vi.spyOn(bridge, "discoverProviders").mockResolvedValue([google]);
    const listModels = vi.spyOn(bridge, "listProviderModels").mockResolvedValue(["gemini-current"]);

    render(<ProviderHub {...baseProps} agentProvider="google" />);

    await waitFor(() => expect(listModels).toHaveBeenCalledWith("google", "", ""));
    expect(await screen.findByRole("button", { name: "Vibe (agent chooses)" })).toBeVisible();
  });

  it("ignores a stale model response after the provider changes", async () => {
    const googleModels = deferred<string[]>();
    const openaiModels = deferred<string[]>();
    vi.spyOn(bridge, "discoverProviders").mockResolvedValue([google, openai]);
    const listModels = vi.spyOn(bridge, "listProviderModels").mockImplementation((provider) => (
      provider === "google" ? googleModels.promise : openaiModels.promise
    ));

    const view = render(<ProviderHub {...baseProps} agentProvider="google" />);
    await waitFor(() => expect(listModels).toHaveBeenCalledWith("google", "", ""));

    view.rerender(<ProviderHub {...baseProps} agentProvider="openai" />);
    await waitFor(() => expect(listModels).toHaveBeenCalledWith("openai", "", ""));
    await act(async () => { openaiModels.resolve(["openai-current"]); });

    fireEvent.click(await screen.findByRole("button", { name: "Vibe (agent chooses)" }));
    expect(await screen.findByRole("option", { name: "openai-current" })).toBeVisible();

    await act(async () => { googleModels.resolve(["google-stale"]); });
    expect(screen.queryByText("google-stale")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "openai-current" })).toBeVisible();
  });

  it("does not expose native provider-scan details in the UI", async () => {
    vi.spyOn(bridge, "discoverProviders").mockRejectedValue(new Error("Bearer private-provider-token"));

    render(<ProviderHub {...baseProps} agentProvider="auto" />);

    expect(await screen.findByText("Provider scan failed. Try refreshing the catalog.")).toBeVisible();
    expect(screen.queryByText(/private-provider-token/)).not.toBeInTheDocument();
  });
});

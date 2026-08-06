/**
 * App-level smoke test: every workspace view must render its surface without
 * crashing in the browser (non-native) path. Guards against dead navigation
 * targets and regressions in the hub headers.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

// The bridge guards on `window.__TAURI_INTERNALS__`; keep everything on the
// browser path so views render their browser-mode surfaces.
beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const railButtons = async () => screen.getAllByRole("button");

describe("App surface navigation", () => {
  it("renders the build surface first", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("What are we shipping?")).toBeTruthy());
  });

  it(
    "opens every hub without crashing and shows its hero header",
    async () => {
      render(<App />);
      await waitFor(() => expect(screen.getByText("What are we shipping?")).toBeTruthy());

      // Browser (non-native) mode: workspace-gated hubs render a gate with the
      // feature name; ungated hubs render their real surface.
      const direct: { button: string; text: RegExp }[] = [
        { button: "Scheduled", text: /Scheduled tasks/ },
        { button: "Plugins", text: /Plugins/ },
      ];
      for (const { button, text } of direct) {
        const target = (await railButtons()).find((b) => b.textContent?.includes(button));
        expect(target, `rail button "${button}" should exist`).toBeTruthy();
        fireEvent.click(target!);
        await waitFor(() => expect(screen.getByText(text)).toBeTruthy(), { timeout: 4000 });
      }

      const openMore = async () => {
        const moreBtn = (await railButtons()).find((b) => b.textContent?.includes("More"));
        expect(moreBtn, "More button should exist").toBeTruthy();
        fireEvent.click(moreBtn!);
        await waitFor(async () => {
          const items = await screen.findAllByRole("menuitem").catch(() => []);
          expect(items.length).toBeGreaterThan(0);
        }, { timeout: 4000 });
      };

      // Items inside the "More" dropdown
      const moreCases: { button: string; text: RegExp }[] = [
        { button: "Services", text: /Service provisioning/ },
        { button: "Ecosystem", text: /Ecosystem needs a workspace/ },
        { button: "Sites", text: /Sites needs a workspace/ },
        { button: "Pull requests", text: /Pull requests/ },
        { button: "Models & providers", text: /Providers/ },
        { button: "Creative studio", text: /Creative Studio/ },
        { button: "Chat", text: /Ask quick questions with Chat/ },
        { button: "Ship", text: /preflight|Ship/i },
        { button: "Autopilot", text: /Autopilot/ },
      ];
      for (const { button, text } of moreCases) {
        await openMore();
        const item = (await screen.findAllByRole("menuitem")).find((el) => el.textContent?.includes(button));
        expect(item, `menu item "${button}" should exist`).toBeTruthy();
        fireEvent.click(item!);
        await waitFor(() => expect(screen.getByText(text)).toBeTruthy(), { timeout: 4000 });
        // Give the menu time to fully close before reopening
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    60000
  );

  it("command palette opens with Ctrl+K and Enter runs the selected command", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("What are we shipping?")).toBeTruthy());

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy());

    // Type to filter to a single command and press Enter to run it.
    fireEvent.change(screen.getByPlaceholderText("What do you want to do?"), {
      target: { value: "pull requests" },
    });
    const item = await screen.findByText("Review pull requests");
    expect(item).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Pull requests/)).toBeTruthy(), { timeout: 4000 });
  });

  it("settings opens with Ctrl+, and every category renders without crashing", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("What are we shipping?")).toBeTruthy());

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("heading", { name: "General" })).toBeTruthy());

    const categories: { button: string; marker: RegExp }[] = [
      { button: "Personalization", marker: /Custom instructions/ },
      { button: "Chat", marker: /Local chat data/ },
      { button: "Appearance", marker: /Surface contrast/ },
      { button: "Voice", marker: /Ambient voice/ },
      { button: "Keyboard shortcuts", marker: /Command palette/ },
      { button: "Updates", marker: /Update channel|Release channel|Check for updates/ },
      { button: "Configuration", marker: /Capabilities/ },
      { button: "Computer use", marker: /Screen capture/ },
    ];
    for (const { button, marker } of categories) {
      const target = screen.getByRole("button", { name: new RegExp(`^${button}$`) });
      fireEvent.click(target);
      await waitFor(() => expect(screen.getByText(marker)).toBeTruthy(), { timeout: 4000 });
    }
  });

  it("sending a message in browser mode shows the honest preview notice", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("What are we shipping?")).toBeTruthy());

    const textarea = document.querySelector(".composer-textarea");
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea!, { target: { value: "build me a landing page" } });
    fireEvent.keyDown(textarea!, { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/Preview mode/)).toBeTruthy(), { timeout: 4000 });
    // The user bubble and the quoted preview notice both contain the request.
    expect(screen.getAllByText(/build me a landing page/).length).toBeGreaterThan(0);
  });
});

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
});

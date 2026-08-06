import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkles } from "lucide-react";
import { HubHeader } from "./HubHeader";

describe("HubHeader", () => {
  it("renders kicker, title, and description", () => {
    render(<HubHeader kicker="Ship" title="Release & deploy" description="Preflight and promote." />);
    expect(screen.getByRole("heading", { name: "Release & deploy" })).toBeTruthy();
    expect(screen.getByText("Ship")).toBeTruthy();
    expect(screen.getByText("Preflight and promote.")).toBeTruthy();
  });

  it("renders optional icon and actions", () => {
    render(
      <HubHeader
        kicker="Ecosystem"
        title="Integrations"
        description="Browse integrations."
        icon={<Sparkles data-testid="hero-icon" size={13} />}
        actions={<button type="button">Refresh</button>}
      />
    );
    expect(screen.getByTestId("hero-icon")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });
});

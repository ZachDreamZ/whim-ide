import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IntentBriefInput } from "../lib/intent-brief";
import { IntentBriefCard } from "./IntentBriefCard";

describe("IntentBriefCard", () => {
  it("does not simulate a persisted brief in browser preview", () => {
    render(<IntentBriefCard native={false} workspaceOpen brief={null} onSave={vi.fn()} />);

    expect(screen.getByText("Structured briefs are saved in the installed Windows app.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /save brief/i })).not.toBeInTheDocument();
  });

  it("submits a structured, user-editable brief to the native persistence boundary", async () => {
    const onSave = vi.fn<(input: IntentBriefInput) => Promise<void>>().mockResolvedValue(undefined);
    render(<IntentBriefCard native workspaceOpen brief={null} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: /no saved brief yet/i }));
    fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Make release reviewable" } });
    fireEvent.change(screen.getByLabelText("Acceptance criteria"), { target: { value: "Show preflight evidence" } });
    fireEvent.click(screen.getByRole("button", { name: "Save brief" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      goal: "Make release reviewable",
      acceptanceCriteria: ["Show preflight evidence"],
    }));
  });
});

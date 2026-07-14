import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LivePreviewCanvas } from "./LivePreviewCanvas";

describe("LivePreviewCanvas", () => {
  it("does not fabricate a localhost preview", () => {
    render(<LivePreviewCanvas />);

    expect(screen.getByText("No local preview is running")).toBeVisible();
    expect(screen.queryByTitle("Local application preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload preview" })).toBeDisabled();
  });

  it("renders only a reported preview URL", () => {
    render(<LivePreviewCanvas url="http://127.0.0.1:3000" />);

    expect(screen.getByTitle("Local application preview")).toHaveAttribute("src", "http://127.0.0.1:3000");
    expect(screen.getByRole("button", { name: "mobile preview" })).toBeEnabled();
  });
});

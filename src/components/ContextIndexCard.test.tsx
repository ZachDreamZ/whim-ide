import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildProjectContextIndex } from "../lib/context-index";
import { ContextIndexCard } from "./ContextIndexCard";

describe("ContextIndexCard", () => {
  it("shows exactly the bounded paths supplied to a native task", () => {
    const index = buildProjectContextIndex([
      { path: "AGENTS.md", kind: "file", modifiedMs: 100 },
      { path: "src/routes/projects.ts", kind: "file", modifiedMs: 200 },
      { path: ".env", kind: "file", modifiedMs: 300 },
    ], 1_000);
    render(<ContextIndexCard native workspaceOpen index={index} />);

    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    expect(screen.getByText("AGENTS.md")).toBeVisible();
    expect(screen.getByText("src/routes/projects.ts")).toBeVisible();
    expect(screen.getByText("1 sensitive path omitted")).toBeVisible();
    expect(screen.queryByText(".env")).not.toBeInTheDocument();
  });

  it("does not manufacture a context inventory in browser preview", () => {
    const index = buildProjectContextIndex([], 1_000);
    render(<ContextIndexCard native={false} workspaceOpen index={index} />);

    expect(screen.getByText("Context inventory becomes available after the native app opens a project.")).toBeVisible();
  });
});

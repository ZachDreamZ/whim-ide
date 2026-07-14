import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CitationChip } from "./SourcesSidebar";

describe("CitationChip", () => {
  it("dispatches the citation id through the shared window event", () => {
    const listener = vi.fn();
    window.addEventListener("whim:citation", listener);
    render(<CitationChip id={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Open source 3" }));

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent<number>).detail).toBe(3);
    window.removeEventListener("whim:citation", listener);
  });
});

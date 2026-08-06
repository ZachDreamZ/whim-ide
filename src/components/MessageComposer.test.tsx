import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageComposer } from "./MessageComposer";

function enterInto(container: HTMLElement, patch: Partial<KeyboardEventInit> = {}) {
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("No textarea in composer");
  fireEvent.change(textarea, { target: { value: "hello" } });
  fireEvent.keyDown(textarea, { key: "Enter", ...patch });
  return textarea;
}

describe("MessageComposer send shortcut", () => {
  it("sends on Enter by default and keeps Shift+Enter for newlines", () => {
    const onSend = vi.fn();
    const { container } = render(<MessageComposer onSend={onSend} />);

    enterInto(container);
    expect(onSend).toHaveBeenCalledWith("hello");
    onSend.mockClear();

    enterInto(container, { shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("uses Ctrl+Enter to send when enter-to-send is disabled", () => {
    const onSend = vi.fn();
    const { container } = render(<MessageComposer onSend={onSend} enterToSend={false} />);

    // Plain Enter inserts a newline instead of sending
    enterInto(container);
    expect(onSend).not.toHaveBeenCalled();

    // Ctrl+Enter sends
    enterInto(container, { ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("renders the keyboard hint matching the current binding", () => {
    const { container, rerender } = render(<MessageComposer onSend={vi.fn()} />);
    expect(container.textContent).toContain("Enter");
    expect(container.textContent).toContain("Shift");

    rerender(<MessageComposer onSend={vi.fn()} enterToSend={false} />);
    expect(container.textContent).toContain("Ctrl");
  });
});

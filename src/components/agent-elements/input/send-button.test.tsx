import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SendButton } from "./send-button";

describe("SendButton", () => {
  it("is keyboard-accessible and disabled when there is no message", () => {
    const onClick = vi.fn();
    render(<SendButton state="idle" onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Send message" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("exposes an operable stop control while streaming", () => {
    const onClick = vi.fn();
    render(<SendButton state="streaming" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

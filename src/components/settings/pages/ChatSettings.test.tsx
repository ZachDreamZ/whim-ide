import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../lib/bridge";
import { ChatSettings } from "./ChatSettings";

describe("ChatSettings", () => {
  it("updates real composer and transcript preferences", () => {
    const onChange = vi.fn();
    render(<ChatSettings settings={structuredClone(defaultAppSettings)} onChange={onChange} saving={false} />);

    fireEvent.click(screen.getByRole("switch", { name: "Enter sends message" }));
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0].chat.enterToSend).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: "Copy actions" }));
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0].chat.showCopyActions).toBe(false);
  });
});

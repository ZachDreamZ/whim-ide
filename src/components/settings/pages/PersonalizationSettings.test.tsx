import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../lib/bridge";
import { PersonalizationSettings } from "./PersonalizationSettings";

describe("PersonalizationSettings", () => {
  it("persists response preferences and memory controls", () => {
    const onChange = vi.fn();
    render(<PersonalizationSettings settings={structuredClone(defaultAppSettings)} onChange={onChange} saving={false} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "concise" } });
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0].personalization.responseStyle).toBe("concise");

    fireEvent.click(screen.getByRole("switch", { name: "Use project memory" }));
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0].personalization.projectMemory).toBe(false);
  });

  it("saves custom instructions on blur", () => {
    const onChange = vi.fn();
    render(<PersonalizationSettings settings={structuredClone(defaultAppSettings)} onChange={onChange} saving={false} />);

    const instructions = screen.getByRole("textbox", { name: "Custom instructions" });
    fireEvent.change(instructions, { target: { value: "Prefer exact evidence." } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(instructions);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0].personalization.customInstructions).toBe("Prefer exact evidence.");
  });
});

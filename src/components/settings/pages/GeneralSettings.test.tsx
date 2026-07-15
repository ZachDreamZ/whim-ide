import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../lib/bridge";
import { ConfigurationSettings } from "./ConfigurationSettings";

describe("ConfigurationSettings", () => {
  it("emits a persisted runtime change", () => {
    const onChange = vi.fn();
    render(<ConfigurationSettings settings={structuredClone(defaultAppSettings)} onChange={onChange} saving={false} />);
    fireEvent.change(screen.getAllByDisplayValue("native")[0], { target: { value: "pi" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ agent: expect.objectContaining({ runtime: "pi" }) }));
  });

  it("removes disabled capabilities from the runtime spec", () => {
    const onChange = vi.fn();
    render(<ConfigurationSettings settings={structuredClone(defaultAppSettings)} onChange={onChange} saving={false} />);
    fireEvent.click(screen.getByRole("switch", { name: "Workspace coding" }));
    const next = onChange.mock.calls[0][0];
    expect(next.agent.enabledCapabilities).not.toContain("coding");
    expect(next.agent.enabledCapabilities).toContain("workspace");
  });

  it("can opt in to real Windows desktop control", () => {
    const onChange = vi.fn();
    render(<ConfigurationSettings settings={structuredClone(defaultAppSettings)} onChange={onChange} saving={false} />);
    fireEvent.click(screen.getByRole("switch", { name: "Windows desktop control" }));
    const next = onChange.mock.calls[0][0];
    expect(next.agent.enabledCapabilities).toContain("computer-use");
  });
});

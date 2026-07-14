import { describe, expect, it } from "vitest";
import { shouldSubmitOnEnter } from "./input-bar";

const key = (patch: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  key: "Enter",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...patch,
});

describe("InputBar send shortcut", () => {
  it("uses Enter and reserves Shift+Enter for a newline by default", () => {
    expect(shouldSubmitOnEnter(key(), true)).toBe(true);
    expect(shouldSubmitOnEnter(key({ shiftKey: true }), true)).toBe(false);
  });

  it("uses Ctrl/Cmd+Enter when Enter-to-send is disabled", () => {
    expect(shouldSubmitOnEnter(key(), false)).toBe(false);
    expect(shouldSubmitOnEnter(key({ ctrlKey: true }), false)).toBe(true);
    expect(shouldSubmitOnEnter(key({ metaKey: true }), false)).toBe(true);
  });
});

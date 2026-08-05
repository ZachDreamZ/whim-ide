import { describe, expect, it } from "vitest";
import { generateConversationTitle, isContinuationOnly } from "./history";

describe("history title helpers", () => {
  it("filters standalone continuation noise and prefixed continuation titles", () => {
    expect(isContinuationOnly("continue")).toBe(true);
    expect(isContinuationOnly("Agent: next")).toBe(true);
    expect(isContinuationOnly("Fix the provider flow")).toBe(false);
  });

  it("generates useful titles while keeping continuation turns out of history chrome", () => {
    expect(generateConversationTitle("continue")).toBe("New chat");
    expect(generateConversationTitle("Build a task detail surface. Then verify it."))
      .toBe("Build a task detail surface.");
  });
});

import { describe, expect, it } from "vitest";
import { formatToolDetail } from "./AgentConversation";

describe("formatToolDetail", () => {
  it("keeps both the input and result available for a reviewable tool timeline", () => {
    expect(formatToolDetail({
      args: { path: "src/App.tsx" },
      result: { changed: true, lines: 12 },
    })).toContain('"output"');
    expect(formatToolDetail({
      args: { path: "src/App.tsx" },
      result: { changed: true },
    })).toContain('"src/App.tsx"');
  });

  it("bounds oversized output so one tool cannot take over the transcript", () => {
    expect(formatToolDetail({ args: {}, result: "x".repeat(9_000) }))
      .toContain("output truncated for this review surface");
  });
});

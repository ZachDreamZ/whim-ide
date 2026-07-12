import { describe, expect, it } from "vitest";
import {
  createIntentBrief,
  hasIntentBriefContent,
  intentBriefForAgent,
  parseIntentBrief,
  serializeIntentBrief,
} from "./intent-brief";

describe("intent brief", () => {
  it("creates a portable, bounded brief without retaining obvious secrets", () => {
    const brief = createIntentBrief({
      goal: "Build a billing page\nAPI_KEY=sk_this_should_not_be_stored",
      users: ["Owners", "owners", "Operators"],
      acceptanceCriteria: ["Invoice history is visible"],
      designDirection: "Calm, high-density admin UI",
    }, 1234);

    expect(brief.goal).toContain("API_KEY=[redacted]");
    expect(brief.goal).not.toContain("sk_this_should_not_be_stored");
    expect(brief.users).toEqual(["Owners", "Operators"]);
    expect(brief.updatedAtMs).toBe(1234);
  });

  it("round-trips valid user-owned JSON and rejects malformed or empty files", () => {
    const brief = createIntentBrief({ goal: "Make project setup reliable" }, 1234);
    expect(parseIntentBrief(serializeIntentBrief(brief))).toEqual(brief);
    expect(parseIntentBrief("not json")).toBeNull();
    expect(parseIntentBrief('{"version":1}')).toBeNull();
  });

  it("provides descriptive context without treating it as an authorization grant", () => {
    const brief = createIntentBrief({
      goal: "Create a reviewable release flow",
      constraints: ["Do not deploy to production"],
      acceptanceCriteria: ["A preflight report is visible"],
    });

    const context = intentBriefForAgent(brief);
    expect(hasIntentBriefContent(brief)).toBe(true);
    expect(context).toContain("does not override safety policies");
    expect(context).toContain("Constraints:\n- Do not deploy to production");
    expect(context).toContain("Acceptance criteria:\n- A preflight report is visible");
  });
});

import { describe, expect, it } from "vitest";
import { displayModelChoice } from "./ProviderHub";

describe("displayModelChoice", () => {
  it("keeps Auto internal and presents it as Vibe", () => {
    expect(displayModelChoice("auto")).toBe("Vibe (agent chooses)");
    expect(displayModelChoice("gpt-5.4")).toBe("gpt-5.4");
  });
});

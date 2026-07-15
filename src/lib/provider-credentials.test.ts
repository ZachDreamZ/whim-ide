import { describe, expect, it } from "vitest";
import { providerHasEnvironmentCredential } from "./provider-credentials";

describe("providerHasEnvironmentCredential", () => {
  it("recognizes every supported Google credential alias", () => {
    expect(providerHasEnvironmentCredential("google", ["GOOGLE_API_KEY"])).toBe(true);
    expect(providerHasEnvironmentCredential("google", ["GEMINI_API_KEY"])).toBe(true);
    expect(providerHasEnvironmentCredential("google", ["google_generative_ai_api_key"])).toBe(true);
  });

  it("does not apply one provider's credential to another", () => {
    expect(providerHasEnvironmentCredential("anthropic", ["OPENAI_API_KEY"])).toBe(false);
    expect(providerHasEnvironmentCredential("compatible", ["OPENAI_API_KEY"])).toBe(false);
  });
});

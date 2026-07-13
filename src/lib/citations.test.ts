import { describe, expect, it } from "vitest";
import { extractCitationSources } from "./citations";

describe("citation source extraction", () => {
  it("preserves numbered reference links and deduplicates bare URLs", () => {
    const sources = extractCitationSources([
      "A supported claim [2].\n\n[2]: https://docs.example.com/guide \"Primary guide\"\nAlso see https://docs.example.com/guide.",
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id: 2, domain: "docs.example.com", title: "Primary guide" });
  });

  it("turns real markdown links into sequential sources", () => {
    const sources = extractCitationSources(["Read [API reference](https://api.example.dev/v1/reference)."]);
    expect(sources[0]).toMatchObject({ id: 1, title: "API reference", domain: "api.example.dev" });
  });
});

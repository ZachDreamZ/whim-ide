import { describe, expect, it } from "vitest";
import { inspectProject } from "./project";

describe("inspectProject", () => {
  it("identifies Eve before its underlying web dependencies", () => {
    const profile = inspectProject(
      [{ path: "package.json", kind: "file" }],
      JSON.stringify({
        scripts: { dev: "eve dev", build: "eve build" },
        dependencies: { eve: "^0.24.4", next: "latest", react: "latest" },
      }),
    );
    expect(profile.framework).toBe("Vercel Eve");
    expect(profile.devCommand).toBe("npm run dev");
  });
});

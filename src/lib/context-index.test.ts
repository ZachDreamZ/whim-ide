import { describe, expect, it } from "vitest";
import type { WorkspaceEntry } from "../types/workbench";
import {
  buildProjectContextIndex,
  contextIndexForAgent,
  contextIndexSummary,
} from "./context-index";

const files: WorkspaceEntry[] = [
  { path: "src/routes/projects.ts", kind: "file", modifiedMs: 120 },
  { path: "AGENTS.md", kind: "file", modifiedMs: 110 },
  { path: "package.json", kind: "file", modifiedMs: 100 },
  { path: "prisma/schema.prisma", kind: "file", modifiedMs: 130 },
  { path: "tests/project.spec.ts", kind: "file", modifiedMs: 90 },
  { path: "docs/architecture.md", kind: "file", modifiedMs: 80 },
  { path: "vercel.json", kind: "file", modifiedMs: 70 },
  { path: ".env.production", kind: "file", modifiedMs: 999 },
  { path: "node_modules/not-a-context.md", kind: "file", modifiedMs: 999 },
];

describe("project context index", () => {
  it("maps inspectable project sources and excludes sensitive or generated paths", () => {
    const index = buildProjectContextIndex(files, 1_000);

    expect(index.categories.rules.map((source) => source.path)).toEqual(["AGENTS.md"]);
    expect(index.categories.architecture.map((source) => source.path)).toEqual(["docs/architecture.md", "package.json"]);
    expect(index.categories.routes.map((source) => source.path)).toEqual(["src/routes/projects.ts"]);
    expect(index.categories.schemas.map((source) => source.path)).toEqual(["prisma/schema.prisma"]);
    expect(index.categories.tests.map((source) => source.path)).toEqual(["tests/project.spec.ts"]);
    expect(index.categories.docs).toEqual([]);
    expect(index.categories.deployment.map((source) => source.path)).toEqual(["vercel.json"]);
    expect(index.sensitiveExcludedCount).toBe(1);
    expect(index.freshAtMs).toBe(130);
  });

  it("builds a bounded path-only agent context with visible token estimate", () => {
    const index = buildProjectContextIndex(files, 1_000);
    const context = contextIndexForAgent(index);

    expect(context).toContain("path metadata only");
    expect(context).toContain("AGENTS.md");
    expect(context).toContain("Sensitive path names omitted: 1");
    expect(context).not.toContain(".env.production");
    expect(contextIndexSummary(index)).toMatch(/^\d+ sources? · ~\d+ tokens$/);
    expect(index.estimatedPromptTokens).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  languageForPath,
  normalizeCommandResult,
  normalizeWorkspacePath,
  terminalTranscript,
  workspaceParentPaths,
} from "./workbench";

describe("workspace helpers", () => {
  it("normalizes Windows paths and calculates parent folders", () => {
    expect(normalizeWorkspacePath("./src\\components\\")).toBe("src/components");
    expect(workspaceParentPaths("src/components/TaskLedger.tsx")).toEqual([
      "src",
      "src/components",
    ]);
  });

  it("selects a safe editor language from known file extensions", () => {
    expect(languageForPath("routes/dashboard.TSX")).toBe("typescript");
    expect(languageForPath("scripts/release.ps1")).toBe("powershell");
    expect(languageForPath("untrusted.extension")).toBe("plaintext");
  });

  it("normalizes command results and keeps a useful terminal transcript", () => {
    expect(normalizeCommandResult("ready", "npm run check", "C:/work")).toEqual({
      command: "npm run check",
      cwd: "C:/work",
      success: true,
      stdout: "ready",
    });

    const transcript = terminalTranscript([
      {
        id: "check-1",
        command: "npm run check",
        cwd: "C:/work",
        success: false,
        status: "failed",
        stderr: "typecheck failed",
        exitCode: 2,
        durationMs: 123.4,
      },
    ]);

    expect(transcript).toContain("powershell C:/work> npm run check");
    expect(transcript).toContain("typecheck failed");
    expect(transcript).toContain("[failed · exit 2 · 123 ms]");
  });
});

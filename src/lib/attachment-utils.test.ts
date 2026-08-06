import { describe, expect, it } from "vitest";
import {
  attachmentPathIsSensitive,
  localPreviewUrlFromEvent,
  workspaceRelativeAttachmentPath,
} from "./attachment-utils";

describe("workspace attachments", () => {
  it("accepts only descendants of the active workspace", () => {
    expect(workspaceRelativeAttachmentPath("C:\\repo", "C:\\repo\\src\\main.ts")).toBe("src/main.ts");
    expect(workspaceRelativeAttachmentPath("C:\\repo", "C:\\repo-other\\main.ts")).toBeNull();
    expect(workspaceRelativeAttachmentPath("C:\\repo", "C:\\outside\\main.ts")).toBeNull();
  });

  it("blocks credential-shaped attachment paths", () => {
    expect(attachmentPathIsSensitive(".env.local")).toBe(true);
    expect(attachmentPathIsSensitive(".pi/agent/auth.json")).toBe(true);
    expect(attachmentPathIsSensitive("src/id_ed25519")).toBe(true);
    expect(attachmentPathIsSensitive("src/config.ts")).toBe(false);
  });
});

describe("local preview evidence", () => {
  it("accepts only reported loopback HTTP URLs", () => {
    expect(localPreviewUrlFromEvent({ output: "Ready at http://localhost:3000" })).toBe("http://localhost:3000");
    expect(localPreviewUrlFromEvent({ output: "Ready at http://127.0.0.1:1420/path" })).toBe("http://127.0.0.1:1420");
    expect(localPreviewUrlFromEvent({ output: "https://public.example.com" })).toBeNull();
  });
});

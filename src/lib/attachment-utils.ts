/**
 * Attachment path utilities shared by the chat surfaces. Extracted from the
 * retired MissionControl component so the two chat experiences enforce the
 * same workspace-bounding and sensitive-path rules.
 */

/** Resolve a native-selected absolute path to a path inside `workspace`, or
 *  null when the file is outside the workspace (including sibling folders
 *  whose name merely prefixes the workspace root). */
export function workspaceRelativeAttachmentPath(workspace: string, selectedPath: string) {
  const root = workspace.replace(/\\/g, "/").replace(/\/+$/, "");
  const selected = selectedPath.replace(/\\/g, "/");
  if (!selected.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
  const relative = selected.slice(root.length + 1);
  return relative && !relative.split("/").includes("..") ? relative : null;
}

/** Pull the loopback preview URL out of a native event payload, if any. */
export function localPreviewUrlFromEvent(event: unknown) {
  const match = JSON.stringify(event).match(/http:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}/i);
  return match?.[0] ?? null;
}

/** Block credential- and secret-shaped attachment paths. */
export function attachmentPathIsSensitive(path: string) {
  const normalized = path.toLowerCase();
  return normalized.split("/").some((part) => part === ".env" || part.startsWith(".env."))
    || /(^|\/)(credentials?|secrets?|auth\.json|id_rsa|id_ed25519)(\/|$)/i.test(normalized);
}

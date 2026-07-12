import type {
  WorkbenchCommandResult,
  WorkbenchTerminalRecord,
  WorkspaceEntry,
} from "../types/workbench";

export function normalizeWorkspacePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

export function workspaceEntryName(entry: WorkspaceEntry) {
  return (
    entry.name ||
    normalizeWorkspacePath(entry.path).split("/").filter(Boolean).pop() ||
    entry.path
  );
}

export function workspaceEntryDepth(entry: WorkspaceEntry) {
  const segments = normalizeWorkspacePath(entry.path).split("/").filter(Boolean);
  return Math.max(0, segments.length - 1);
}

export function workspaceParentPaths(path: string) {
  const segments = normalizeWorkspacePath(path).split("/").filter(Boolean);
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

export function languageForPath(path: string) {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".tsx") || normalized.endsWith(".ts")) return "typescript";
  if (normalized.endsWith(".jsx") || normalized.endsWith(".js")) return "javascript";
  if (normalized.endsWith(".json") || normalized.endsWith(".jsonc")) return "json";
  if (normalized.endsWith(".css")) return "css";
  if (normalized.endsWith(".scss") || normalized.endsWith(".sass")) return "scss";
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) return "html";
  if (normalized.endsWith(".md") || normalized.endsWith(".mdx")) return "markdown";
  if (normalized.endsWith(".rs")) return "rust";
  if (normalized.endsWith(".py")) return "python";
  if (normalized.endsWith(".go")) return "go";
  if (normalized.endsWith(".java")) return "java";
  if (normalized.endsWith(".yml") || normalized.endsWith(".yaml")) return "yaml";
  if (normalized.endsWith(".xml")) return "xml";
  if (normalized.endsWith(".sql")) return "sql";
  if (normalized.endsWith(".ps1")) return "powershell";
  if (
    normalized.endsWith(".sh") ||
    normalized.endsWith(".bash") ||
    normalized.endsWith(".zsh")
  ) {
    return "shell";
  }
  return "plaintext";
}

export function normalizeCommandResult(
  value: string | WorkbenchCommandResult,
  command: string,
  cwd?: string,
): WorkbenchCommandResult {
  if (typeof value === "string") {
    return { command, cwd, success: true, stdout: value };
  }
  return {
    ...value,
    command: value.command || command,
    cwd: value.cwd || cwd,
  };
}

export function failedCommandResult(
  error: unknown,
  command: string,
  cwd?: string,
): WorkbenchCommandResult {
  return {
    command,
    cwd,
    success: false,
    stderr: error instanceof Error ? error.message : "Command failed",
  };
}

export function terminalRecordStatus(
  result: WorkbenchCommandResult,
): WorkbenchTerminalRecord["status"] {
  if (result.cancelled) return "cancelled";
  if (result.timedOut) return "timed-out";
  return result.success ? "succeeded" : "failed";
}

export function terminalTranscript(
  records: readonly WorkbenchTerminalRecord[],
  shell = "powershell",
  fallbackCwd?: string,
) {
  if (records.length === 0) return "No command output yet.";

  return records
    .map((record) => {
      const cwd = record.cwd || fallbackCwd;
      const prompt = cwd ? `${shell} ${cwd}>` : `${shell}>`;
      const chunks = [`${prompt} ${record.command}`];
      if (record.status === "running") chunks.push("Running…");
      if (record.stdout?.trim()) chunks.push(record.stdout.trimEnd());
      if (record.stderr?.trim()) chunks.push(record.stderr.trimEnd());
      if (
        record.message?.trim() &&
        !record.stdout?.trim() &&
        !record.stderr?.trim()
      ) {
        chunks.push(record.message.trim());
      }
      if (record.status !== "running") {
        const exit = record.exitCode == null ? "" : ` · exit ${record.exitCode}`;
        const duration =
          record.durationMs == null ? "" : ` · ${Math.round(record.durationMs)} ms`;
        chunks.push(`[${record.status}${exit}${duration}]`);
      }
      return chunks.join("\n");
    })
    .join("\n\n");
}

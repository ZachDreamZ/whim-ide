export type WorkspaceEntryKind = "file" | "directory" | "symlink" | "other";

export type WorkspaceEntry = {
  path: string;
  name?: string;
  kind: WorkspaceEntryKind;
  size?: number;
  modifiedMs?: number | null;
  status?: string;
};

export type WorkspaceContextItem = {
  id: string;
  label: string;
  tone?: "mint" | "violet" | "coral" | "neutral";
};

export type LivingBrief = {
  eyebrow?: string;
  title: string;
};

export type CanvasMode = "preview" | "code" | "changes";

export type PreviewStatus = "idle" | "starting" | "ready" | "error";

export type WorkbenchPreview = {
  url?: string | null;
  externalUrl?: string | null;
  displayUrl?: string;
  title?: string;
  status?: PreviewStatus;
  error?: string | null;
  width?: number;
  height?: number;
  revision?: string | number;
};

/** A user-selected point in a preview. This is coordinate annotation only. */
export type PreviewRegionSelection = {
  xPercent: number;
  yPercent: number;
  viewportWidth: number;
  viewportHeight: number;
  url?: string | null;
  selectedAtMs: number;
};

export type DiffLineKind = "context" | "added" | "removed";

export type WorkbenchDiffLine = {
  kind: DiffLineKind;
  content: string;
  oldLine?: number | null;
  newLine?: number | null;
};

export type WorkbenchDiffHunk = {
  id: string;
  header?: string;
  lines: WorkbenchDiffLine[];
};

export type WorkbenchFileChange = {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
  summary?: string;
  hunks?: WorkbenchDiffHunk[];
};

export type WorkbenchCheckStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped";

export type WorkbenchCheck = {
  id: string;
  label: string;
  status: WorkbenchCheckStatus;
  detail?: string;
};

export type WorkbenchProblemSeverity = "error" | "warning" | "info";

export type WorkbenchProblem = {
  id: string;
  message: string;
  severity: WorkbenchProblemSeverity;
  path?: string;
  line?: number;
  column?: number;
};

export type WorkbenchCommandStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed-out";

export type WorkbenchCommandSource = "check" | "terminal";

export type WorkbenchCommandRequest = {
  operationId: string;
  cwd?: string;
  source: WorkbenchCommandSource;
};

export type WorkbenchCommandResult = {
  operationId?: string;
  command?: string;
  cwd?: string;
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
  cancelled?: boolean;
  message?: string;
};

export type WorkbenchTerminalRecord = WorkbenchCommandResult & {
  id: string;
  command: string;
  status: WorkbenchCommandStatus;
  startedAt?: number;
};

export type WorkbenchTerminalState = {
  shell?: string;
  cwd?: string;
  records?: readonly WorkbenchTerminalRecord[];
};

export type WorkbenchChangeSummary = {
  title: string;
  detail?: string;
  acceptLabel?: string;
};

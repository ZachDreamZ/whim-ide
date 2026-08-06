type CachedToolState = {
  state: string | undefined;
  inputJson: string;
  outputJson: string;
};

const toolStateCache = new Map<string, CachedToolState>();

/* eslint-disable @typescript-eslint/no-explicit-any -- Tool payloads are provider-defined JSON with open schemas. */

export type ToolJsonValue =
  | string
  | number
  | boolean
  | null
  | ToolJsonValue[]
  | { [key: string]: ToolJsonValue };

export type ToolObject = Record<string, unknown>;

export type ToolPartBase = {
  type: string;
  id?: string;
  toolCallId?: string;
  state?: string;
  input?: any;
  output?: any;
  args?: any;
  result?: any;
  startedAt?: number;
  callProviderMetadata?: {
    custom?: {
      startedAt?: number;
    };
  };
};

export function isToolObject(value: unknown): value is ToolObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasSuccessfulOutput(output: unknown): boolean | undefined {
  if (!isToolObject(output)) return undefined;
  return typeof output.success === "boolean" ? output.success : undefined;
}

function getToolStateSnapshot(part: ToolPartBase): CachedToolState {
  return {
    state: part.state,
    inputJson: JSON.stringify(part.input || {}),
    outputJson: JSON.stringify(part.output || {}),
  };
}

function hasToolStateChanged(toolCallId: string, part: ToolPartBase): boolean {
  const cached = toolStateCache.get(toolCallId);
  const current = getToolStateSnapshot(part);

  if (!cached) {
    toolStateCache.set(toolCallId, current);
    return true;
  }

  const changed =
    cached.state !== current.state ||
    cached.inputJson !== current.inputJson ||
    cached.outputJson !== current.outputJson;

  if (changed) {
    toolStateCache.set(toolCallId, current);
  }

  return changed;
}

function arePartsEqual(prev: ToolPartBase & { toolCallId?: string; type: string }, next: ToolPartBase & { toolCallId?: string; type: string }): boolean {
  if (prev.toolCallId !== next.toolCallId) return false;
  if (prev.type !== next.type) return false;

  const toolCallId = next.toolCallId;
  if (!toolCallId) {
    return prev.state === next.state;
  }

  const changed = hasToolStateChanged(toolCallId, next);
  return !changed;
}

function isToolCompleted(part: ToolPartBase): boolean {
  if (part.output !== undefined && part.output !== null) return true;
  if (part.state === "error") return true;
  if (part.state === "result") return true;
  return false;
}

/** Deep compare function for tool part props. Used with React.memo(). */
export function areToolPropsEqual(
  prevProps: { part: ToolPartBase & { toolCallId?: string; type: string }; chatStatus?: string },
  nextProps: { part: ToolPartBase & { toolCallId?: string; type: string }; chatStatus?: string },
): boolean {
  const partsEqual = arePartsEqual(prevProps.part, nextProps.part);
  if (!partsEqual) return false;
  if (isToolCompleted(nextProps.part)) return true;
  if (prevProps.chatStatus !== nextProps.chatStatus) return false;
  return true;
}

/** Get tool status from part state */
export function getToolStatus(part: ToolPartBase, chatStatus?: string) {
  const basePending =
    part.state !== "output-available" && part.state !== "output-error";
  const isError =
    part.state === "output-error" ||
    (part.state === "output-available" && hasSuccessfulOutput(part.output) === false);
  const isSuccess = part.state === "output-available" && !isError;
  const isPending = basePending && chatStatus === "streaming";
  const isInterrupted =
    basePending && chatStatus !== "streaming" && chatStatus !== undefined;

  return { isPending, isError, isSuccess, isInterrupted };
}

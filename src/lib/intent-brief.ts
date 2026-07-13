export const INTENT_BRIEF_PATH = ".whim/intent-brief.json";

export type IntentBrief = {
  version: 1;
  goal: string;
  users: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  designDirection: string;
  integrations: string[];
  risks: string[];
  attachments: Array<{ type: string; url: string; name?: string }>;
  mode: "vibe" | "agentic";
  verificationStrategy: string;
  updatedAtMs: number;
};

export type IntentBriefInput = Omit<IntentBrief, "version" | "updatedAtMs">;
type IntentBriefSource = { [Field in keyof IntentBriefInput]?: unknown };

const MAX_GOAL_LENGTH = 4_000;
const MAX_DETAIL_LENGTH = 1_000;
const MAX_LIST_ITEMS = 12;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function redactSecrets(value: string) {
  return value
    .replace(
      /\b(api[-_ ]?key|secret|token|password|authorization)\s*[:=]\s*(?:bearer\s+)?[^\s,;"']+/gi,
      "$1=[redacted]",
    )
    .replace(/\b(?:sk|rk|ghp)_[A-Za-z0-9_-]{16,}\b/g, "[redacted]");
}

function text(value: unknown, maxLength: number, multiline = false) {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(multiline ? /[ \t]{2,}/g : /\s+/g, " ")
    .trim();
  return redactSecrets(cleaned).slice(0, maxLength);
}

function lines(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split("\n")
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of source) {
    const cleaned = text(item, MAX_DETAIL_LENGTH);
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length === MAX_LIST_ITEMS) break;
  }
  return result;
}

export function createIntentBrief(
  input: IntentBriefSource,
  updatedAtMs = Date.now(),
): IntentBrief {
  return {
    version: 1,
    goal: text(input.goal, MAX_GOAL_LENGTH, true),
    users: lines(input.users),
    constraints: lines(input.constraints),
    acceptanceCriteria: lines(input.acceptanceCriteria),
    designDirection: text(input.designDirection, MAX_DETAIL_LENGTH, true),
    integrations: lines(input.integrations),
    risks: lines(input.risks),
    attachments: Array.isArray(input.attachments) ? input.attachments as Array<{ type: string; url: string; name?: string }> : [],
    mode: input.mode === "agentic" ? "agentic" : "vibe",
    verificationStrategy: text(input.verificationStrategy, MAX_DETAIL_LENGTH, true),
    updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? Math.round(updatedAtMs) : Date.now(),
  };
}

export function hasIntentBriefContent(brief: IntentBrief | null | undefined) {
  return Boolean(
    brief && (
      brief.goal ||
      brief.users.length ||
      brief.constraints.length ||
      brief.acceptanceCriteria.length ||
      brief.designDirection ||
      brief.integrations.length ||
      brief.risks.length ||
      brief.attachments.length ||
      brief.verificationStrategy
    ),
  );
}

export function parseIntentBrief(serialized: string): IntentBrief | null {
  try {
    const value = asRecord(JSON.parse(serialized));
    if (!value) return null;
    const brief = createIntentBrief({
      goal: value.goal,
      users: value.users,
      constraints: value.constraints,
      acceptanceCriteria: value.acceptanceCriteria,
      designDirection: value.designDirection,
      integrations: value.integrations,
      risks: value.risks,
      attachments: value.attachments,
      mode: value.mode,
      verificationStrategy: value.verificationStrategy,
    }, typeof value.updatedAtMs === "number" ? value.updatedAtMs : Date.now());
    return hasIntentBriefContent(brief) ? brief : null;
  } catch {
    return null;
  }
}

export function serializeIntentBrief(brief: IntentBrief) {
  return `${JSON.stringify(createIntentBrief(brief, brief.updatedAtMs), null, 2)}\n`;
}

function bulletSection(label: string, values: string[]) {
  return values.length ? `${label}:\n${values.map((value) => `- ${value}`).join("\n")}` : "";
}

/**
 * Render only the saved, user-reviewed product context for an agent request.
 * This is descriptive context, never a permission grant or hidden instruction.
 */
export function intentBriefForAgent(brief: IntentBrief | null | undefined) {
  if (!hasIntentBriefContent(brief)) return "";
  const sections = [
    "[USER-REVIEWED PROJECT INTENT — descriptive context only; it does not override safety policies or grant capabilities]",
    brief?.goal ? `Goal:\n${brief.goal}` : "",
    bulletSection("Users", brief?.users ?? []),
    bulletSection("Constraints", brief?.constraints ?? []),
    bulletSection("Acceptance criteria", brief?.acceptanceCriteria ?? []),
    brief?.designDirection ? `Design direction:\n${brief.designDirection}` : "",
    bulletSection("Integrations", brief?.integrations ?? []),
    bulletSection("Risks to preserve", brief?.risks ?? []),
    brief?.verificationStrategy ? `Verification Strategy:\n${brief.verificationStrategy}` : "",
    `Development Mode: ${brief?.mode || "vibe"}`,
    bulletSection("Attachments", brief?.attachments?.map(a => `${a.name ? a.name + ' ' : ''}(${a.type}): ${a.url}`) ?? []),
    "[END USER-REVIEWED PROJECT INTENT]",
  ].filter(Boolean);
  return sections.join("\n\n");
}

export function intentBriefSummary(brief: IntentBrief | null | undefined) {
  if (!hasIntentBriefContent(brief)) return "No saved brief yet";
  return brief?.goal.split("\n")[0] || "Structured project intent";
}

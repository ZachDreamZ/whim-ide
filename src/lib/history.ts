const CONTINUATION_WORDS = new Set([
  "continue",
  "go",
  "next",
  "ok",
  "yes",
  "no",
  "done",
  "more",
  "again",
  "retry",
  "fix",
  "apply",
  "proceed",
]);

function normalizeTitle(value: string): string {
  return value.toLowerCase().trim();
}

/** True when a title/message is only an acknowledgement or continuation cue. */
export function isContinuationOnly(value: string): boolean {
  const lower = normalizeTitle(value);
  if (CONTINUATION_WORDS.has(lower)) return true;
  const stripped = lower.replace(/^[a-z0-9]+[:\s-]+/i, "").trim();
  return stripped.length > 0 && CONTINUATION_WORDS.has(stripped);
}

/** Generate a stable, useful chat title without turning "continue" into history noise. */
export function generateConversationTitle(content: string, maxLength = 72): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (!cleaned || isContinuationOnly(cleaned)) return "New chat";
  const sentence = cleaned.match(/^(.+?[.!?])\s/)?.[1] ?? cleaned;
  return sentence.length > maxLength
    ? `${sentence.slice(0, Math.max(0, maxLength - 3))}...`
    : sentence;
}

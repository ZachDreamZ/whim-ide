export type CitationSource = {
  id: number;
  domain: string;
  title: string;
  snippet: string;
  url: string;
};

function cleanUrl(raw: string) {
  return raw.replace(/^</, "").replace(/>$/, "").replace(/[),.;!?]+$/, "");
}

function sourceFor(id: number, rawUrl: string, title?: string, snippet?: string): CitationSource | null {
  const url = cleanUrl(rawUrl);
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return {
      id,
      domain: parsed.hostname.replace(/^www\./, ""),
      title: title?.trim() || parsed.hostname,
      snippet: snippet?.trim() || parsed.pathname.replace(/[-_/]+/g, " ").trim() || "Referenced source",
      url: parsed.toString(),
    };
  } catch {
    return null;
  }
}

/** Extract citation definitions and real links from assistant output. */
export function extractCitationSources(texts: readonly string[]): CitationSource[] {
  const byUrl = new Map<string, CitationSource>();
  const usedIds = new Set<number>();
  let nextId = 1;
  const reserve = (preferred?: number) => {
    if (preferred && !usedIds.has(preferred)) { usedIds.add(preferred); return preferred; }
    while (usedIds.has(nextId)) nextId += 1;
    usedIds.add(nextId);
    return nextId++;
  };
  const add = (rawUrl: string, title?: string, preferred?: number, snippet?: string) => {
    const normalized = cleanUrl(rawUrl);
    if (byUrl.has(normalized)) return;
    const source = sourceFor(reserve(preferred), normalized, title, snippet);
    if (source) byUrl.set(normalized, source);
  };

  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      const definition = /^\s*\[(\d{1,3})\]:\s*<?(https?:\/\/[^\s>]+)>?(?:\s+["'(]([^"')]+)["')])?/i.exec(line);
      if (definition) add(definition[2], definition[3], Number(definition[1]), line.replace(definition[0], ""));
    }
    for (const match of text.matchAll(/\[([^\n]+?)\]\((https?:\/\/[^)\s]+)\)/gi)) {
      add(match[2], match[1], /^\d+$/.test(match[1]) ? Number(match[1]) : undefined);
    }
    for (const match of text.matchAll(/https?:\/\/[^\s<>{}[\]"']+/gi)) add(match[0]);
  }
  return [...byUrl.values()].sort((left, right) => left.id - right.id);
}

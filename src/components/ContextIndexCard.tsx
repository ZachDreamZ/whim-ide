import { ChevronDown, Clock3, FileSearch, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  CONTEXT_CATEGORIES,
  contextCategoryLabel,
  contextIndexSummary,
  type ProjectContextIndex,
} from "../lib/context-index";

type ContextIndexCardProps = {
  native: boolean;
  workspaceOpen: boolean;
  index: ProjectContextIndex;
};

function timestamp(value: number | null) {
  if (!value) return "timestamps unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ContextIndexCard({ native, workspaceOpen, index }: ContextIndexCardProps) {
  const [expanded, setExpanded] = useState(false);
  const available = native && workspaceOpen;

  return (
    <section className="context-index-card" aria-label="Agent context inventory">
      <button className="context-index-trigger" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span className="context-index-icon"><FileSearch size={12} /></span>
        <span className="context-index-copy"><small>{available ? "next task context" : native ? "open a project" : "Windows app"}</small><strong>{available ? contextIndexSummary(index) : "Context inventory unavailable"}</strong></span>
        <ChevronDown className={expanded ? "expanded" : ""} size={13} />
      </button>

      {!available ? (
        <div className="context-index-notice"><ShieldCheck size={11} /> Context inventory becomes available after the native app opens a project.</div>
      ) : expanded ? (
        <div className="context-index-detail">
          <p>Whim supplies these bounded paths, counts, and freshness metadata to the next task—not raw project files.</p>
          <div className="context-index-meta"><span><Clock3 size={10} /> Freshest indexed file: {timestamp(index.freshAtMs)}</span><span>{index.sensitiveExcludedCount} sensitive path{index.sensitiveExcludedCount === 1 ? "" : "s"} omitted</span></div>
          {index.sourceCount === 0 ? <small className="context-index-empty">No recognized context sources in the current file inventory.</small> : (
            <ul>
              {CONTEXT_CATEGORIES.map((category) => {
                const sources = index.categories[category];
                if (sources.length === 0) return null;
                const omitted = index.truncatedByCategory[category];
                return <li key={category}><strong>{contextCategoryLabel(category)}</strong><span>{sources.map((source) => source.path).join(", ")}{omitted ? ` (+${omitted} more)` : ""}</span></li>;
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

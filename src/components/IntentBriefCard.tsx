import { ChevronDown, FileText, LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type IntentBrief,
  type IntentBriefInput,
  intentBriefSummary,
} from "../lib/intent-brief";

type IntentBriefCardProps = {
  native: boolean;
  workspaceOpen: boolean;
  brief: IntentBrief | null;
  onSave: (input: IntentBriefInput) => Promise<void>;
};

type BriefDraft = {
  goal: string;
  users: string;
  constraints: string;
  acceptanceCriteria: string;
  designDirection: string;
  integrations: string;
  risks: string;
};

function draftFromBrief(brief: IntentBrief | null): BriefDraft {
  return {
    goal: brief?.goal ?? "",
    users: brief?.users.join("\n") ?? "",
    constraints: brief?.constraints.join("\n") ?? "",
    acceptanceCriteria: brief?.acceptanceCriteria.join("\n") ?? "",
    designDirection: brief?.designDirection ?? "",
    integrations: brief?.integrations.join("\n") ?? "",
    risks: brief?.risks.join("\n") ?? "",
  };
}

function inputFromDraft(draft: BriefDraft): IntentBriefInput {
  return {
    goal: draft.goal,
    users: draft.users.split("\n"),
    constraints: draft.constraints.split("\n"),
    acceptanceCriteria: draft.acceptanceCriteria.split("\n"),
    designDirection: draft.designDirection,
    integrations: draft.integrations.split("\n"),
    risks: draft.risks.split("\n"),
  };
}

export function IntentBriefCard({ native, workspaceOpen, brief, onSave }: IntentBriefCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<BriefDraft>(() => draftFromBrief(brief));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(draftFromBrief(brief));
  }, [brief]);

  const update = (field: keyof BriefDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.goal.trim()) {
      setError("Add a concrete goal before saving a project brief.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(inputFromDraft(draft));
      setExpanded(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the intent brief.");
    } finally {
      setSaving(false);
    }
  };

  const available = native && workspaceOpen;

  return (
    <section className="intent-brief-card" aria-label="Project intent brief">
      <button
        className="intent-brief-trigger"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="intent-brief-card-icon"><FileText size={12} /></span>
        <span className="intent-brief-card-copy"><small>{available ? ".whim / portable" : native ? "open a project" : "Windows app"}</small><strong>{intentBriefSummary(brief)}</strong></span>
        <ChevronDown className={expanded ? "expanded" : ""} size={13} />
      </button>

      {!native ? (
        <div className="intent-brief-notice"><ShieldCheck size={11} /> Structured briefs are saved in the installed Windows app.</div>
      ) : !workspaceOpen ? (
        <div className="intent-brief-notice"><ShieldCheck size={11} /> Open a project to save a portable intent brief.</div>
      ) : expanded ? (
        <form className="intent-brief-form" onSubmit={save}>
          <p>The agent uses only the saved brief. Keep credentials and private values out of it.</p>
          <label>Goal<textarea aria-label="Goal" value={draft.goal} onChange={(event) => update("goal", event.target.value)} rows={3} placeholder="What should be true when this work is complete?" /></label>
          <div className="intent-brief-grid">
            <label>Users<textarea aria-label="Users" value={draft.users} onChange={(event) => update("users", event.target.value)} rows={2} placeholder="One per line" /></label>
            <label>Acceptance<textarea aria-label="Acceptance criteria" value={draft.acceptanceCriteria} onChange={(event) => update("acceptanceCriteria", event.target.value)} rows={2} placeholder="One per line" /></label>
            <label>Constraints<textarea aria-label="Constraints" value={draft.constraints} onChange={(event) => update("constraints", event.target.value)} rows={2} placeholder="One per line" /></label>
            <label>Integrations<textarea aria-label="Integrations" value={draft.integrations} onChange={(event) => update("integrations", event.target.value)} rows={2} placeholder="One per line" /></label>
          </div>
          <label>Design direction<textarea aria-label="Design direction" value={draft.designDirection} onChange={(event) => update("designDirection", event.target.value)} rows={2} placeholder="Tone, layout, references, or interaction direction" /></label>
          <label>Risks to preserve<textarea aria-label="Risks to preserve" value={draft.risks} onChange={(event) => update("risks", event.target.value)} rows={2} placeholder="Security, data, compatibility, or delivery risks" /></label>
          {error && <p className="intent-brief-error" role="alert">{error}</p>}
          <div className="intent-brief-actions"><small><ShieldCheck size={10} /> Ordinary JSON in your project</small><button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={11} /> : <Save size={11} />}{saving ? "Saving" : "Save brief"}</button></div>
        </form>
      ) : null}
    </section>
  );
}

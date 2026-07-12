import { Check, Circle, LoaderCircle, Rocket, Sparkles } from "lucide-react";

type RibbonState = "idle" | "editing" | "agent" | "checking" | "deploying";

type OrchestrationRibbonProps = {
  workspaceOpen: boolean;
  state?: RibbonState;
  detail?: string;
  onPause?: () => void;
};

export function OrchestrationRibbon({ workspaceOpen, state = "idle", detail, onPause }: OrchestrationRibbonProps) {
  const activeIndex = !workspaceOpen ? -1 : state === "agent" || state === "editing" ? 2 : state === "checking" ? 3 : state === "deploying" ? 4 : 1;
  const stages = ["Intent", "Shape", "Build", "Verify", "Preview", "Ship"].map((label, index) => ({
    label,
    state: index < activeIndex ? "done" : index === activeIndex ? "active" : "queued",
    detail: index === activeIndex ? (detail || (state === "idle" ? "workspace ready" : state)) : index < activeIndex ? "complete" : "waiting",
  }));
  const running = ["agent", "checking", "deploying"].includes(state);

  return (
    <section className="orchestration-ribbon" aria-label="Current workspace activity">
      <div className="orchestration-intro">
        <span className="pulse-glyph"><Sparkles size={13} /></span>
        <div><strong>{workspaceOpen ? (running ? "Work is running" : state === "editing" ? "Editing locally" : "Workspace ready") : "Open a workspace"}</strong><small>{detail || (workspaceOpen ? "Native actions report their real status here" : "Choose a project folder to begin")}</small></div>
      </div>
      <div className="stage-track">
        <span className="stage-line" />
        {stages.map((stage) => (
          <div className={`stage stage-${stage.state}`} key={stage.label}>
            <span className="stage-node">
              {stage.state === "done" && <Check size={10} strokeWidth={3} />}
              {stage.state === "active" && (running ? <LoaderCircle size={11} /> : <Circle size={8} />)}
              {stage.state === "queued" && (stage.label === "Ship" ? <Rocket size={10} /> : <Circle size={8} />)}
            </span>
            <span><strong>{stage.label}</strong><small>{stage.detail}</small></span>
          </div>
        ))}
      </div>
      {running && onPause ? <button className="quiet-button" type="button" onClick={onPause}>Stop</button> : <span className="quiet-button" aria-hidden="true">{workspaceOpen ? "Ready" : "Idle"}</span>}
    </section>
  );
}

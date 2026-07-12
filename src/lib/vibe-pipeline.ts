// Vibe Engine — pipeline lifecycle state machine.
// Ported from the provided VibePipelineTracker reference, hardened so state
// transitions are deterministic and never race the step that produced them.

export type PipelineState =
  | "INTENT"
  | "SHAPE"
  | "BUILD"
  | "VERIFY"
  | "PREVIEW"
  | "SHIP"
  | "FAILED";

export const PIPELINE_STAGES: PipelineState[] = [
  "INTENT",
  "SHAPE",
  "BUILD",
  "VERIFY",
  "PREVIEW",
  "SHIP",
];

export class VibePipelineTracker {
  private currentState: PipelineState = "INTENT";
  private onStateChangeCallback: (state: PipelineState) => void;

  constructor(onStateChange: (state: PipelineState) => void) {
    this.onStateChangeCallback = onStateChange;
  }

  public transitionTo(nextState: PipelineState): void {
    if (nextState !== "FAILED" && !PIPELINE_STAGES.includes(nextState)) {
      console.warn(`Ignoring invalid pipeline state: ${nextState}`);
      return;
    }
    if (this.currentState === nextState) return;
    this.currentState = nextState;
    this.onStateChangeCallback(this.currentState);
  }

  public getCurrentState(): PipelineState {
    return this.currentState;
  }

  // Run an execution step and transition only after it resolves: to the target
  // stage on success, to FAILED otherwise. The original reference transitioned
  // BEFORE awaiting, letting the FAILED transition race the success path.
  public async handleExecutionStep(
    stepName: PipelineState,
    action: () => Promise<boolean>,
  ): Promise<void> {
    try {
      const success = await action();
      this.transitionTo(success ? stepName : "FAILED");
    } catch {
      this.transitionTo("FAILED");
    }
  }
}

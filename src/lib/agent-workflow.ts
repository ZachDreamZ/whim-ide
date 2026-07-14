import type { OrchestrationJobMode } from "./bridge";

export type MissionAgentMode =
  | "auto"
  | "planner"
  | "researcher"
  | "implementer"
  | "reviewer"
  | "tester"
  | "securityReviewer"
  | "designer"
  | "debugger"
  | "releaseAgent"
  | "gameDesigner"
  | "techArtist"
  | "playtester"
  | "assetGenerator"
  | "refactorer"
  | "dataScientist"
  | "accessibilityExpert"
  | "localizer";

export type MissionWorkflow = {
  agent: MissionAgentMode;
  jobMode: OrchestrationJobMode;
  instruction: string;
};

export const DEFAULT_MISSION_MODE: MissionAgentMode = "auto";

const WORKFLOWS: Record<MissionAgentMode, MissionWorkflow> = {
  auto: {
    agent: "auto",
    jobMode: "auto",
    instruction: "Orchestrate a workflow of specialized agents to solve the user's intent. Do not execute work directly; delegate each bounded task to the appropriate role.",
  },
  planner: {
    agent: "planner",
    jobMode: "plan",
    instruction: "Inspect this project and create a concrete implementation plan with acceptance criteria, risks, files likely to change, and the lightest relevant verification. Do not edit files or run commands.",
  },
  researcher: {
    agent: "researcher",
    jobMode: "research",
    instruction: "Investigate and summarize the requested topic or codebase structure without making changes.",
  },
  implementer: {
    agent: "implementer",
    jobMode: "build",
    instruction: "Implement the requested outcome in this workspace. Inspect before editing, complete the necessary code, and run the lightest relevant verification available.",
  },
  reviewer: {
    agent: "reviewer",
    jobMode: "review",
    instruction: "Review the relevant implementation and project context without editing files or running commands. Return prioritized findings, risk, evidence, and concrete recommendations.",
  },
  tester: {
    agent: "tester",
    jobMode: "verify",
    instruction: "Inspect the relevant implementation and run only safe, native-discovered verification checks. Do not edit files. Report exact evidence, failures, and recommended fixes.",
  },
  securityReviewer: {
    agent: "securityReviewer",
    jobMode: "review",
    instruction: "Perform a security audit of the codebase, looking for vulnerabilities, secrets, and unsafe patterns.",
  },
  designer: {
    agent: "designer",
    jobMode: "build",
    instruction: "Focus on UI/UX improvements, aesthetics, and frontend component structure.",
  },
  debugger: {
    agent: "debugger",
    jobMode: "build",
    instruction: "Diagnose and fix the specified issue, using targeted tests to verify the resolution.",
  },
  releaseAgent: {
    agent: "releaseAgent",
    jobMode: "ship",
    instruction: "Prepare the requested outcome for release. Inspect the project, make only necessary changes, run relevant readiness checks, and do not perform a public or production deployment.",
  },
  gameDesigner: {
    agent: "gameDesigner",
    jobMode: "plan",
    instruction: "Focus on game mechanics, balancing variables, level design algorithms, and Game Design Documents. Do not write standard application code.",
  },
  techArtist: {
    agent: "techArtist",
    jobMode: "build",
    instruction: "Write and debug WebGL, GLSL, HLSL, shaders, particle systems, and visual math. Focus strictly on graphics, rendering, and visual effects.",
  },
  playtester: {
    agent: "playtester",
    jobMode: "verify",
    instruction: "Simulate player input or run automated playthroughs to check for difficulty spikes, logic gaps, or economy imbalances without modifying the code.",
  },
  assetGenerator: {
    agent: "assetGenerator",
    jobMode: "build",
    instruction: "Hook into generative assets or build logic to generate sprite sheets, textures, and sound files for integration.",
  },
  refactorer: {
    agent: "refactorer",
    jobMode: "build",
    instruction: "Clean up technical debt, reorganize files, and extract components to improve architecture without altering behavior.",
  },
  dataScientist: {
    agent: "dataScientist",
    jobMode: "build",
    instruction: "Focus on data pipelines, Jupyter notebooks, plotting, machine learning models, and heavy data analysis workflows.",
  },
  accessibilityExpert: {
    agent: "accessibilityExpert",
    jobMode: "build",
    instruction: "Audit and modify UI components to meet WCAG standards, adding ARIA labels, semantic HTML, and keyboard navigation.",
  },
  localizer: {
    agent: "localizer",
    jobMode: "build",
    instruction: "Detect hardcoded strings, extract them into internationalization files, and apply standard translations.",
  },
};

const SLASH_ROUTES: Record<string, MissionAgentMode> = {
  goal: "auto",
  vibe: "auto",
  plan: "planner",
  research: "researcher",
  implement: "implementer",
  review: "reviewer",
  test: "tester",
  verify: "tester",
  debug: "debugger",
  security: "securityReviewer",
  release: "releaseAgent",
  deploy: "releaseAgent",
  design: "designer",
  refactor: "refactorer",
};

export function missionWorkflow(mode: MissionAgentMode): MissionWorkflow {
  return WORKFLOWS[mode];
}

export function resolveMissionRequest(
  content: string,
  selectedMode: MissionAgentMode = DEFAULT_MISSION_MODE,
): { content: string; command: string | null; workflow: MissionWorkflow } {
  const slashMatch = content.match(/^\/([A-Za-z][\w-]*)\s*(.*)$/s);
  const command = slashMatch?.[1]?.toLowerCase() ?? null;
  const routedMode = command ? SLASH_ROUTES[command] : undefined;
  if (!slashMatch || !routedMode) {
    return { content, command: null, workflow: missionWorkflow(selectedMode) };
  }
  const remainder = slashMatch[2].trim();
  return {
    content: remainder || content,
    command,
    workflow: missionWorkflow(routedMode),
  };
}

export function agentForJobMode(mode: OrchestrationJobMode): string {
  switch (mode) {
    case "auto":
    case "vibe":
      return "auto";
    case "plan":
      return "planner";
    case "research":
      return "researcher";
    case "build":
      return "implementer";
    case "verify":
      return "tester";
    case "review":
      return "reviewer";
    case "ship":
      return "releaseAgent";
    case "operate":
      return "janitor";
  }
}

export function displayWorkflowMode(mode: OrchestrationJobMode): string {
  if (mode === "auto" || mode === "vibe") return "Vibe";
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

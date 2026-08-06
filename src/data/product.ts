import {
  Cloud,
  Container,
  Globe2,
  Layers3,
  Rocket,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type DeployAdapter = {
  id: string;
  name: string;
  description: string;
  command: string;
  icon: LucideIcon;
  color: string;
};

export const deployAdapters: DeployAdapter[] = [
  { id: "vercel", name: "Vercel", description: "Framework-aware preview deployments", command: "vercel", icon: Globe2, color: "#f5f5f5" },
  { id: "netlify", name: "Netlify", description: "Sites, functions, and deploy previews", command: "netlify", icon: Sparkles, color: "#55e6cf" },
  { id: "cloudflare", name: "Cloudflare", description: "Workers, Pages, D1, and R2", command: "wrangler", icon: Cloud, color: "#ff9e45" },
  { id: "render", name: "Render", description: "Blueprint-backed apps and databases", command: "render", icon: Layers3, color: "#8976ff" },
  { id: "railway", name: "Railway", description: "Services from source or containers", command: "railway", icon: Rocket, color: "#b08cff" },
  { id: "fly", name: "Fly.io", description: "Global apps built from OCI images", command: "fly", icon: Globe2, color: "#8b9cff" },
  { id: "docker", name: "Docker", description: "Portable local or self-hosted delivery", command: "docker", icon: Container, color: "#5daeff" },
];

export type AutomationSetting = {
  id: string;
  label: string;
  description: string;
  group: "Create" | "Verify" | "Personalize" | "Ship";
  defaultEnabled: boolean;
  locked?: boolean;
};

export const automationSettings: AutomationSetting[] = [
  { id: "route", label: "Route each task to the right model", description: "Balance quality, speed, privacy, and cost automatically.", group: "Create", defaultEnabled: true },
  { id: "preview", label: "Keep a live preview running", description: "Detect the dev command and recover ports without asking.", group: "Create", defaultEnabled: true },
  { id: "checkpoint", label: "Checkpoint every accepted outcome", description: "Create reversible snapshots before agents move on.", group: "Create", defaultEnabled: true },
  { id: "repair", label: "Repair routine failures", description: "Fix lint, type, formatting, and simple test failures in the background.", group: "Verify", defaultEnabled: true },
  { id: "journeys", label: "Verify user journeys", description: "Run the lightest useful browser checks while you iterate.", group: "Verify", defaultEnabled: true },
  { id: "security", label: "Escalate security-sensitive changes", description: "Require review for auth, payments, secrets, policies, and migrations.", group: "Verify", defaultEnabled: true, locked: true },
  { id: "rules", label: "Learn preferences from corrections", description: "Propose durable, editable rules such as package manager and style choices.", group: "Personalize", defaultEnabled: true },
  { id: "layout", label: "Adapt the workspace layout", description: "Show the panels and tools that match the current phase.", group: "Personalize", defaultEnabled: true },
  { id: "docs", label: "Maintain living project knowledge", description: "Keep journeys, decisions, architecture, and integrations current.", group: "Personalize", defaultEnabled: true },
  { id: "deploy-preview", label: "Deploy previews automatically", description: "Create a private preview after readiness gates pass.", group: "Ship", defaultEnabled: false },
  { id: "prod-confirm", label: "Always confirm production releases", description: "Production, billing, secrets, and destructive actions require you.", group: "Ship", defaultEnabled: true, locked: true },
];

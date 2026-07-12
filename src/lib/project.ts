import type { WorkbenchFileChange, WorkspaceEntry } from "../types/workbench";

export type ProjectProfile = {
  framework: string | null;
  packageManager: string | null;
  checkCommand: string | null;
  devCommand: string | null;
};

const textExtensions = /\.(?:[cm]?[jt]sx?|jsonc?|mdx?|css|scss|html?|rs|py|go|java|cs|cpp|c|h|ya?ml|toml|txt|sql|ps1|sh)$/i;

export function chooseInitialFile(entries: readonly WorkspaceEntry[]): string | null {
  const files = entries.filter((entry) => entry.kind === "file" && (textExtensions.test(entry.path) || /(^|\/)(README|LICENSE)$/i.test(entry.path)));
  const priorities = ["README.md", "package.json", "src/App.tsx", "src/main.tsx", "src/index.ts", "src/main.rs", "pyproject.toml"];
  for (const path of priorities) {
    const match = files.find((entry) => entry.path.replace(/\\/g, "/").toLowerCase() === path.toLowerCase());
    if (match) return match.path;
  }
  return files[0]?.path ?? null;
}

export function inspectProject(entries: readonly WorkspaceEntry[], packageJson?: string | null): ProjectProfile {
  const paths = new Set(entries.map((entry) => entry.path.replace(/\\/g, "/").toLowerCase()));
  let packageManager: string | null = null;
  if (paths.has("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (paths.has("yarn.lock")) packageManager = "yarn";
  else if (paths.has("bun.lock") || paths.has("bun.lockb")) packageManager = "bun";
  else if (paths.has("package-lock.json") || paths.has("package.json")) packageManager = "npm";

  let framework: string | null = null;
  let scripts: Record<string, string> = {};
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      scripts = pkg.scripts ?? {};
      const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (dependencies.next) framework = "Next.js";
      else if (dependencies.vite || dependencies["@vitejs/plugin-react"]) framework = "Vite";
      else if (dependencies["@sveltejs/kit"]) framework = "SvelteKit";
      else if (dependencies.nuxt) framework = "Nuxt";
      else if (dependencies.react) framework = "React";
      else if (dependencies.vue) framework = "Vue";
    } catch { /* the editor will surface malformed package.json when opened */ }
  }
  if (!framework && paths.has("cargo.toml")) framework = "Rust";
  if (!framework && [...paths].some((path) => path.endsWith(".sln") || path.endsWith(".csproj"))) framework = ".NET";
  if (!framework && (paths.has("pyproject.toml") || paths.has("requirements.txt"))) framework = "Python";

  const run = (script: string) => packageManager === "yarn" ? `yarn ${script}` : packageManager === "pnpm" ? `pnpm ${script}` : packageManager === "bun" ? `bun run ${script}` : `npm run ${script}`;
  const checkScript = ["check", "typecheck", "build", "test"].find((name) => scripts[name]);
  const devScript = ["dev", "start"].find((name) => scripts[name]);
  let checkCommand = checkScript ? run(checkScript) : null;
  let devCommand = devScript ? run(devScript) : null;
  if (!checkCommand && paths.has("cargo.toml")) checkCommand = "cargo check";
  if (!checkCommand && [...paths].some((path) => path.endsWith(".sln") || path.endsWith(".csproj"))) checkCommand = "dotnet build";
  if (!checkCommand && paths.has("pyproject.toml")) checkCommand = "python -m pytest";
  if (!devCommand && paths.has("cargo.toml") && [...paths].some((path) => path.startsWith("src/"))) devCommand = "cargo run";
  return { framework, packageManager, checkCommand, devCommand };
}

export function parseGitState(statusOutput: string, numstatOutput: string): { branch: string | null; changes: WorkbenchFileChange[] } {
  const lines = statusOutput.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## "));
  const branch = branchLine ? branchLine.slice(3).split(/[. ]/)[0] || null : null;
  const stats = new Map<string, { additions?: number; deletions?: number }>();
  for (const line of numstatOutput.split(/\r?\n/)) {
    const [added, deleted, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t").replace(/\\/g, "/");
    if (!path) continue;
    stats.set(path, {
      additions: /^\d+$/.test(added) ? Number(added) : undefined,
      deletions: /^\d+$/.test(deleted) ? Number(deleted) : undefined,
    });
  }
  const changes = lines.filter((line) => !line.startsWith("## ") && line.length > 3).map((line) => {
    const status = line.slice(0, 2).trim() || "M";
    const rawPath = line.slice(3).trim();
    const path = (rawPath.includes(" -> ") ? rawPath.split(" -> ").pop()! : rawPath).replace(/^"|"$/g, "").replace(/\\/g, "/");
    return { path, status, ...(stats.get(path) ?? {}), summary: status === "??" ? "Untracked file" : `Git status: ${status}` };
  });
  return { branch, changes };
}

export function findPreviewUrl(output?: string): string | null {
  return output?.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s]*)?/i)?.[0] ?? null;
}

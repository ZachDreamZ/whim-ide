/**
 * Release helper for Whim IDE — builds NSIS installer + generates update manifest.
 *
 * Usage:
 *   node scripts/release.mjs [patch|minor|major]
 *
 * Requires:
 *   - TAURI_PRIVATE_KEY  — Tauri signing key (generated once, keep secret)
 *   - TAURI_KEY_PASSWORD — Key passphrase (optional)
 *
 * First-time setup:
 *   npx tauri signer generate -w ~/.tauri/whim.key
 *   setx TAURI_PRIVATE_KEY "file://$env:USERPROFILE\.tauri\whim.key"
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MANIFEST_FILE = resolve(ROOT, "update-manifest.json");
const RELEASES_DIR = resolve(ROOT, "target/release-upload");

// ── Bump version ──────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
const toml = readFileSync(resolve(ROOT, "src-tauri/Cargo.toml"), "utf-8");
const bump = process.argv[2] ?? "patch";

const semver = (v) => v.split(".").map(Number);
const bumpVer = (v, kind) => {
  const parts = semver(v);
  if (kind === "major") { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (kind === "minor") { parts[1]++; parts[2] = 0; }
  else { parts[2]++; }
  return parts.join(".");
};

const newVersion = bumpVer(pkg.version, bump);
console.log(`Bumping v${pkg.version} → v${newVersion}`);

pkg.version = newVersion;
writeFileSync(resolve(ROOT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

const newToml = toml.replace(/^version = ".*"/m, `version = "${newVersion}"`);
writeFileSync(resolve(ROOT, "src-tauri/Cargo.toml"), newToml);

// Also update tauri.conf.json version
const confPath = resolve(ROOT, "src-tauri/tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf-8"));
conf.version = newVersion;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

// ── Build ─────────────────────────────────────────────────────────
console.log("\nBuilding Tauri app (release mode, NSIS target)…");
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
execSync("npx tauri build --bundles nsis", { cwd: ROOT, stdio: "inherit" });

// ── Locate installer ──────────────────────────────────────────────
const arch = "x64";
const installerGlob = `target/release/bundle/nsis/Whim IDE_${newVersion}_${arch}-setup.exe`;
const installerPath = resolve(ROOT, installerGlob);
if (!existsSync(installerPath)) {
  console.error(`Installer not found at ${installerPath}`);
  console.error("Check target/release/bundle/nsis/ for the actual filename");
  process.exit(1);
}

// ── Generate signature ────────────────────────────────────────────
console.log("\nGenerating update signature…");
let signature;
try {
  const signCmd = `npx tauri signer sign --file "${installerPath}"`;
  const opts = { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" };
  if (process.env.TAURI_KEY_PASSWORD) {
    opts.env = { ...process.env, TAURI_KEY_PASSWORD: process.env.TAURI_KEY_PASSWORD };
  }
  signature = execSync(signCmd, opts).toString().trim();
} catch {
  console.error("Signing failed. Ensure TAURI_PRIVATE_KEY is set.");
  console.error("  set TAURI_PRIVATE_KEY=file://%USERPROFILE%\\.tauri\\whim.key");
  process.exit(1);
}

// ── Write manifest ────────────────────────────────────────────────
const installerName = `Whim-IDE_${newVersion}_${arch}-setup.exe`;
const manifest = {
  version: newVersion,
  notes: `Whim IDE v${newVersion}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/ZachDreamZ/whim-ide/releases/download/v${newVersion}/${installerName}`,
    },
  },
};

mkdirSync(RELEASES_DIR, { recursive: true });
writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");

// Also copy the manifest to the releases dir for convenience
writeFileSync(
  resolve(RELEASES_DIR, "update-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

// Copy installer to releases dir
const destPath = resolve(RELEASES_DIR, installerName);
const fs = await import("node:fs");
await fs.promises.copyFile(installerPath, destPath);

console.log("\n✅ Release ready!");
console.log(`  Version: v${newVersion}`);
console.log(`  Installer: ${installerPath}`);
console.log(`  Manifest: ${MANIFEST_FILE}`);
console.log(`  Release artifacts: ${RELEASES_DIR}/\n`);
console.log("To publish:");
console.log(`  1. git add . && git commit -m "release v${newVersion}" && git tag v${newVersion} && git push && git push --tags`);
console.log(`  2. Upload to https://github.com/ZachDreamZ/whim-ide/releases/new`);
console.log(`     - Tag: v${newVersion}`);
console.log(`     - Assets: ${RELEASES_DIR}/*`);
console.log(`  3. The update-manifest.json at repo root will be picked up by the updater`);

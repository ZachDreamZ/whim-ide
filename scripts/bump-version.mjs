#!/usr/bin/env node
/**
 * Bump Whim's version in every place that defines it, so the packaged app,
 * the npm package, and the runtime-reported APP_VERSION never drift apart.
 *
 *   node scripts/bump-version.mjs 0.4.1
 *
 * Updates (formatting preserved via targeted regex, not full re-serialization):
 *   - package.json            -> "version"
 *   - src-tauri/tauri.conf.json -> "version" (drives the NSIS bundle version)
 *   - src-tauri/Cargo.toml     -> [package] version (Rust crate version)
 *   - src/lib/bridge.ts       -> export const APP_VERSION
 *
 * Uses only the Node stdlib so it runs in CI without extra installs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`Usage: node scripts/bump-version.mjs <semver>  (e.g. 0.4.1)`);
  process.exit(1);
}

const packageJsonPath = resolve(repoRoot, "package.json");
const tauriConfPath = resolve(repoRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = resolve(repoRoot, "src-tauri", "Cargo.toml");
const bridgePath = resolve(repoRoot, "src", "lib", "bridge.ts");

/** Replace the first `"key": "..."` occurrence, preserving surrounding text. */
function bumpJsonField(filePath, key, version) {
  const content = readFileSync(filePath, "utf8");
  const pattern = new RegExp(`("${key}"\\s*:\\s*")([^"]*)(")`);
  if (!pattern.test(content)) {
    throw new Error(`Could not find "${key}" in ${filePath}`);
  }
  const next = content.replace(pattern, `$1${version}$3`);
  writeFileSync(filePath, next);
}

/** Replace the [package] `version = "..."` line (unindented, so dependency versions are untouched). */
function bumpCargoVersion(filePath, version) {
  const content = readFileSync(filePath, "utf8");
  const pattern = /^version = "([^"]*)"$/m;
  if (!pattern.test(content)) {
    throw new Error(`Could not find [package] version in ${filePath}`);
  }
  const next = content.replace(pattern, `version = "${version}"`);
  writeFileSync(filePath, next);
}
function bumpAppVersion(filePath, version) {
  const content = readFileSync(filePath, "utf8");
  const pattern = /(export const APP_VERSION = ")[^"]*(";)/;
  if (!pattern.test(content)) {
    throw new Error(`Could not find APP_VERSION in ${filePath}`);
  }
  const next = content.replace(pattern, `$1${version}$2`);
  writeFileSync(filePath, next);
}

const changed = [];
changed.push(`package.json -> ${readJsonVersion(packageJsonPath)} -> ${newVersion}`);
bumpJsonField(packageJsonPath, "version", newVersion);

changed.push(`src-tauri/tauri.conf.json -> version -> ${newVersion}`);
bumpJsonField(tauriConfPath, "version", newVersion);

changed.push(`src-tauri/Cargo.toml -> [package] version -> ${newVersion}`);
bumpCargoVersion(cargoTomlPath, newVersion);

changed.push(`src/lib/bridge.ts -> APP_VERSION -> ${newVersion}`);
bumpAppVersion(bridgePath, newVersion);

console.log("Bumped version to " + newVersion + ":");
for (const line of changed) console.log("  " + line);
console.log("\nNext: commit these files, then publish a GitHub release to trigger signing + latest.json upload.");

function readJsonVersion(filePath) {
  const content = readFileSync(filePath, "utf8");
  const match = /"version"\s*:\s*"([^"]*)"/.exec(content);
  return match ? match[1] : "?";
}

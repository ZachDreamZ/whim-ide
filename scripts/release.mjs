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
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
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
const installerGlob = `src-tauri/target/release/bundle/nsis/Whim IDE_${newVersion}_${arch}-setup.exe`;
let installerPath = resolve(ROOT, installerGlob);
if (!existsSync(installerPath)) {
  console.error(`Installer not found at ${installerPath}`);
  console.error("Check target/release/bundle/nsis/ for the actual filename");
  process.exit(1);
}

// Tauri emits the installer with a space in the name; normalize to a
// hyphenated name so the download URL stays clean for the updater.
const installerName = `Whim-IDE_${newVersion}_${arch}-setup.exe`;
const normalizedPath = resolve(ROOT, `src-tauri/target/release/bundle/nsis/${installerName}`);
if (!existsSync(normalizedPath)) {
  renameSync(installerPath, normalizedPath);
  console.log(`Renamed installer -> ${installerName}`);
}
installerPath = normalizedPath;

// ── Authenticode code-sign the installer (Windows SmartScreen/Defender) ──
// Tauri's update `.sig` only verifies the update payload to the app; it does
// NOT satisfy Windows code-signing. Without an Authenticode signature Windows
// SmartScreen/Defender flags the installer as an "unknown publisher". Sign the
// .exe with a trusted code-signing certificate to avoid that.
//
// Configure via environment:
//   CODESIGN_CERT        path to a .pfx/.p12 certificate file
//   CODESIGN_PASSWORD    certificate private-key password
//   CODESIGN_TIMESTAMP   RFC3161 timestamp URL (default: Sectigo)
//   CODESIGN_TOOL        "signtool" (default on Windows, needs Windows SDK)
//                        or "osslsigncode" (cross-platform)
// Alternatively select a cert already in the Windows cert store:
//   CODESIGN_SUBJECT     certificate subject (CN) or SHA1 thumbprint
// If neither CODESIGN_CERT nor CODESIGN_SUBJECT is set, signing is SKIPPED
// with a warning and the unsigned installer is used as-is.
function codeSignInstaller(installerPath) {
  const hasPfx = !!process.env.CODESIGN_CERT;
  const hasSubject = !!process.env.CODESIGN_SUBJECT;
  if (!hasPfx && !hasSubject) {
    console.warn(
      "\n⚠️  Authenticode code-signing SKIPPED: no CODESIGN_CERT or " +
        "CODESIGN_SUBJECT set.\n    The installer will trigger Windows " +
        "SmartScreen/Defender as an 'unknown publisher'.\n    Set a code-signing " +
        "certificate (e.g. OV/EV cert or SignPath) to sign automatically."
    );
    return false;
  }

  const timestamp =
    process.env.CODESIGN_TIMESTAMP ||
    "http://timestamp.sectigo.com";
  const tool = (process.env.CODESIGN_TOOL || "signtool").toLowerCase();

  try {
    if (tool === "osslsigncode") {
      if (!hasPfx) {
        throw new Error("osslsigncode requires CODESIGN_CERT (.pfx)");
      }
      const cmd =
        `osslsigncode sign -pkcs12 "${process.env.CODESIGN_CERT}" ` +
        `-pass "${process.env.CODESIGN_PASSWORD || ""}" ` +
        `-t "${timestamp}" -h sha256 ` +
        `-in "${installerPath}" -out "${installerPath}.signed" && ` +
        `move /Y "${installerPath}.signed" "${installerPath}"`;
      execSync(cmd, { cwd: ROOT, stdio: "inherit" });
    } else {
      // Default: signtool (Windows SDK). Use store cert if subject given,
      // otherwise a PFX file.
      let cmd = `signtool sign /fd sha256 /tr "${timestamp}" /td sha256 `;
      if (hasSubject) {
        cmd += `/s My /n "${process.env.CODESIGN_SUBJECT}" `;
      } else {
        cmd += `/f "${process.env.CODESIGN_CERT}" `;
        if (process.env.CODESIGN_PASSWORD) {
          cmd += `/p "${process.env.CODESIGN_PASSWORD}" `;
        }
      }
      cmd += `/v "${installerPath}"`;
      execSync(cmd, { cwd: ROOT, stdio: "inherit" });
    }
    console.log("✔ Installer Authenticode-signed.");
    return true;
  } catch (error) {
    console.error("Authenticode signing failed:", error.message);
    console.error("The unsigned installer was kept. Re-run with a valid cert.");
    process.exit(1);
  }
}

console.log("\nCode-signing installer for Windows…");
codeSignInstaller(installerPath);

// ── Generate Tauri update signature (.sig) ─────────────────────────
// This verifies the update payload to the app; it is INDEPENDENT of the
// Authenticode signature above. Requires TAURI_SIGNING_PRIVATE_KEY_PATH
// (or TAURI_PRIVATE_KEY) to point at whim-release.key.
console.log("\nGenerating Tauri update signature…");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY_PATH && !process.env.TAURI_PRIVATE_KEY) {
  console.error("Update signing skipped: set TAURI_SIGNING_PRIVATE_KEY_PATH to the release key.");
} else {
  const keyEnv =
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH
      ? `TAURI_SIGNING_PRIVATE_KEY_PATH=${process.env.TAURI_SIGNING_PRIVATE_KEY_PATH}`
      : `TAURI_PRIVATE_KEY=${process.env.TAURI_PRIVATE_KEY}`;
  const signCmd = `npx tauri signer sign -p "" "${installerPath}"`;
  try {
    const opts = { cwd: ROOT, stdio: "inherit", encoding: "utf-8" };
    opts.env = { ...process.env };
    execSync(`${keyEnv} ${signCmd}`, opts);
  } catch {
    console.error("Tauri update signing failed. Ensure the key path is correct.");
    process.exit(1);
  }
}
const sigPath = `${installerPath}.sig`;
if (!existsSync(sigPath)) {
  console.error(`Update signature not found at ${sigPath}`);
  process.exit(1);
}
const signature = readFileSync(sigPath, "utf-8").trim();

// ── Write manifest ────────────────────────────────────────────────
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

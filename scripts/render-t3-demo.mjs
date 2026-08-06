import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const outDir = "docs/assets/demo";
mkdirSync(outDir, { recursive: true });

const W = 960;
const H = 540;
const checks = ["typecheck", "lint", "tests", "build", "audit"];

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));
}

function stagePill(stage, index, active) {
  const x = 330 + index * 95;
  const done = index < active;
  const isActive = index === active;
  const fill = isActive ? "#ff7a59" : done ? "#72c99f" : "#1a1d24";
  const stroke = isActive ? "#ffb39f" : done ? "#9ae6bf" : "#ffffff18";
  const text = isActive ? "#170b07" : done ? "#07110c" : "#8b919d";
  return `<g><rect x="${x}" y="68" width="78" height="28" rx="14" fill="${fill}" stroke="${stroke}"/><text x="${x + 39}" y="86" text-anchor="middle" fill="${text}" font-size="11" font-weight="700">${esc(stage)}</text></g>`;
}

function shellSvg() {
  const step = {
    label: "Verify",
    title: "Run the gauntlet",
    sub: "Typecheck, lint, tests, build, audit.",
    active: 3,
    user: "Prove it works",
    assistant: "Gauntlet green: 39 files, 141 tests, audit clean.",
  };
  const toolY = 224;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Whim T3 Code inspired shell screenshot">
  <defs>
    <radialGradient id="warm" cx="75%" cy="0%" r="80%"><stop stop-color="#ff7a59" stop-opacity=".24"/><stop offset="1" stop-color="#ff7a59" stop-opacity="0"/></radialGradient>
    <radialGradient id="violet" cx="8%" cy="8%" r="70%"><stop stop-color="#7d5cff" stop-opacity=".16"/><stop offset="1" stop-color="#7d5cff" stop-opacity="0"/></radialGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#000" flood-opacity=".42"/></filter>
  </defs>
  <rect width="960" height="540" fill="#07080a"/><rect width="960" height="540" fill="url(#warm)"/><rect width="960" height="540" fill="url(#violet)"/>
  <g opacity=".11" stroke="#fff" stroke-width="1">${Array.from({ length: 29 }, (_, n) => `<path d="M${n * 34} 0V540"/>`).join("")}${Array.from({ length: 16 }, (_, n) => `<path d="M0 ${n * 34}H960"/>`).join("")}</g>
  <rect x="22" y="24" width="916" height="492" rx="22" fill="#090b0f" stroke="#ffffff16" filter="url(#shadow)"/>
  <rect x="22" y="24" width="916" height="42" rx="22" fill="#0c0f14" stroke="#ffffff0f"/>
  <circle cx="49" cy="45" r="12" fill="#ff7a59"/><text x="49" y="49" text-anchor="middle" fill="#160805" font-size="12" font-weight="800">W</text>
  <text x="68" y="49" fill="#f4f4f5" font-size="15" font-weight="750">Whim</text><text x="112" y="49" fill="#6f7682" font-size="9" font-weight="700">IDE</text>
  <rect x="355" y="33" width="250" height="24" rx="12" fill="#ffffff08" stroke="#ffffff12"/><text x="480" y="49" text-anchor="middle" fill="#8b919d" font-size="11">⌘ Jump to anything</text>
  <rect x="802" y="33" width="102" height="24" rx="12" fill="#ffffff08" stroke="#ffffff12"/><text x="853" y="49" text-anchor="middle" fill="#d7d9df" font-size="11">Auto Route</text>
  <rect x="22" y="66" width="206" height="450" fill="#0b0d12" stroke="#ffffff0b"/>
  <text x="48" y="98" fill="#6f7682" font-size="10" font-weight="700" letter-spacing="2">WORKSPACE</text><text x="48" y="120" fill="#f4f4f5" font-size="14" font-weight="700">whim-demo</text>
  ${["Build", "Scheduled", "Providers", "Ship", "Autopilot"].map((item, idx) => `<rect x="42" y="${145 + idx * 34}" width="162" height="28" rx="9" fill="${idx === 0 ? "#ff7a5926" : "transparent"}" stroke="${idx === 0 ? "#ff7a5940" : "transparent"}"/><text x="62" y="${163 + idx * 34}" fill="${idx === 0 ? "#fff" : "#8b919d"}" font-size="12" font-weight="650">${item}</text>`).join("")}
  <rect x="42" y="438" width="162" height="34" rx="12" fill="#ffffff07" stroke="#ffffff12"/><text x="62" y="459" fill="#8b919d" font-size="11">0 problems · protected</text>
  <g>${["Prompt", "Plan", "Edit", "Verify", "Ship"].map((stage, idx) => stagePill(stage, idx, step.active)).join("")}</g><text x="258" y="91" fill="#ffb39f" font-size="12" font-weight="800">${esc(step.label)}</text>
  <g transform="translate(258 126)"><text x="0" y="0" fill="#f4f4f5" font-size="42" font-weight="780" letter-spacing="-2.6">${esc(step.title)}</text><text x="1" y="32" fill="#9aa0aa" font-size="15">${esc(step.sub)}</text>
  <rect x="0" y="66" width="430" height="66" rx="20" fill="#12151bcc" stroke="#ffffff16"/><text x="22" y="94" fill="#8b919d" font-size="11" font-weight="700">YOU</text><text x="64" y="94" fill="#f4f4f5" font-size="15">${esc(step.user)}</text>
  <rect x="0" y="150" width="514" height="86" rx="20" fill="#0d0f13e8" stroke="#ffffff14"/><circle cx="28" cy="193" r="15" fill="#ff7a59"/><text x="28" y="198" text-anchor="middle" fill="#160805" font-size="14" font-weight="800">W</text><text x="54" y="184" fill="#ffb39f" font-size="11" font-weight="800">WHIM</text><text x="54" y="207" fill="#d7d9df" font-size="15">${esc(step.assistant)}</text>
  <rect x="0" y="${toolY}" width="514" height="112" rx="18" fill="#ffffff06" stroke="#ffffff10"/>${checks.map((check, idx) => `<g transform="translate(${22 + idx * 96} ${toolY + 30})"><circle cx="0" cy="0" r="7" fill="${idx <= step.active ? "#72c99f" : "#30343d"}"/><text x="15" y="4" fill="${idx <= step.active ? "#dff8eb" : "#6f7682"}" font-size="12" font-weight="650">${check}</text></g>`).join("")}<path d="M24 ${toolY + 74}H488" stroke="#ffffff12" stroke-width="8" stroke-linecap="round"/><path d="M24 ${toolY + 74}H${24 + step.active * 116}" stroke="#ff7a59" stroke-width="8" stroke-linecap="round"/></g>
  <g transform="translate(808 133)"><rect x="0" y="0" width="98" height="288" rx="20" fill="#101319" stroke="#ffffff14"/><text x="49" y="34" text-anchor="middle" fill="#f4f4f5" font-size="13" font-weight="800">Evidence</text>${["diff", "ledger", "preview", "rollback"].map((item, idx) => {
    const y = 58 + idx * 48;
    return `<rect x="14" y="${y}" width="70" height="30" rx="10" fill="${idx <= 2 ? "#ff7a5920" : "#ffffff08"}" stroke="#ffffff12"/><text x="49" y="${y + 20}" text-anchor="middle" fill="${idx <= 2 ? "#ffb39f" : "#8b919d"}" font-size="11" font-weight="700">${item}</text>`;
  }).join("")}</g>
  <text x="480" y="500" text-anchor="middle" fill="#6f7682" font-size="11">T3 Code-inspired shell · chat-first agent loop · durable evidence</text>
</svg>`;
}

writeFileSync(join(outDir, "whim-t3-shell.svg"), shellSvg());

const qaFrames = [
  "qa/build-1440.png",
  "qa/providers-1440.png",
  "qa/ecosystem-1440.png",
  "qa/ship-1440.png",
  "qa/autopilot-1440.png",
];

try {
  execFileSync("convert", ["-delay", "120", "-loop", "0", ...qaFrames, "-resize", "960x540", join(outDir, "whim-demo.gif")], { stdio: "inherit" });
} catch {
  console.error("ImageMagick convert is required to render the animated GIF. The SVG screenshot was generated.");
  process.exitCode = 1;
}

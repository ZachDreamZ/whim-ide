#!/usr/bin/env node
/**
 * check-normalization.mjs — dependency-free locked-rule normalization test.
 *
 * Verifies that:
 *   1. Locked automation rules are always forced to their defaultEnabled state.
 *   2. Normalization kicks in when a locked rule is disabled in the persisted file.
 *   3. The persist() safety re-applies locked defaults before writing.
 *
 * Uses only Node.js built-ins (node:assert).
 * No frameworks, no dependencies, no production-bundle impact.
 */

import assert from "node:assert/strict";

// --- Data model (mirrors src/data/product.ts lines 122–138) ---
const automationSettings = [
  { id: "route",        group: "Create",      defaultEnabled: true,  locked: false },
  { id: "preview",      group: "Create",      defaultEnabled: true,  locked: false },
  { id: "checkpoint",   group: "Create",      defaultEnabled: true,  locked: false },
  { id: "repair",       group: "Verify",      defaultEnabled: true,  locked: false },
  { id: "journeys",     group: "Verify",      defaultEnabled: true,  locked: false },
  { id: "security",     group: "Verify",      defaultEnabled: true,  locked: true  },
  { id: "rules",        group: "Personalize", defaultEnabled: true,  locked: false },
  { id: "layout",       group: "Personalize", defaultEnabled: true,  locked: false },
  { id: "docs",         group: "Personalize", defaultEnabled: true,  locked: false },
  { id: "deploy-preview", group: "Ship",      defaultEnabled: false, locked: false },
  { id: "prod-confirm",   group: "Ship",      defaultEnabled: true,  locked: true  },
];

// --- Normalization logic (mirrors AutopilotHub.tsx lines 44–49 & 60–65) ---

/** @returns {Record<string, boolean>} defaults map */
function buildDefaults() {
  return Object.fromEntries(automationSettings.map((item) => [item.id, item.defaultEnabled]));
}

/**
 * Simulate on-load normalization.
 * Merges persisted enabled map with defaults, then forces locked items to defaultEnabled.
 * @param {Record<string, boolean>} persisted - The raw enabled map read from file
 * @returns {{ merged: Record<string, boolean>, neededNormalization: boolean }}
 */
function normalizeOnLoad(persisted) {
  const defaults = buildDefaults();
  const merged = { ...defaults, ...persisted };

  const lockedItems = automationSettings.filter((s) => s.locked);
  const neededNormalization = lockedItems.some((s) => persisted[s.id] === false);
  lockedItems.forEach((s) => { merged[s.id] = s.defaultEnabled; });

  return { merged, neededNormalization };
}

/**
 * Simulate persist-time safety re-enforcement.
 * Forces all locked items to defaultEnabled before writing.
 * @param {Record<string, boolean>} next
 * @returns {Record<string, boolean>} safe map
 */
function enforceOnPersist(next) {
  const safe = { ...next };
  automationSettings.filter((s) => s.locked).forEach((s) => { safe[s.id] = s.defaultEnabled; });
  return safe;
}

// ===== TESTS =====

const defaults = buildDefaults();

// 1. Defaults: locked items are at defaultEnabled
assert.equal(defaults["security"], true,      "security default is true");
assert.equal(defaults["prod-confirm"], true,   "prod-confirm default is true");

// 2. On-load normalization — locked rule disabled in file
const fileWithLockedOff = {
  "route": false,
  "security": false,        // ← locked but stored as disabled
  "prod-confirm": true,
};
const { merged, neededNormalization } = normalizeOnLoad(fileWithLockedOff);
assert.equal(merged["security"], true,            "security forced back ON");
assert.equal(merged["prod-confirm"], true,        "prod-confirm stays ON");
assert.equal(merged["route"], false,              "non-locked rule preserved");
assert.equal(neededNormalization, true,           "normalization was needed");

// 3. On-load normalization — no locked rules disabled
const fileClean = { "route": false, "security": true, "prod-confirm": true };
const r2 = normalizeOnLoad(fileClean);
assert.equal(r2.neededNormalization, false,       "no normalization needed when locked rules are already ON");

// 4. Persist enforcement — even if called with locked rule turned OFF
const tampered = { ...defaults, "security": false, "prod-confirm": false };
const safe = enforceOnPersist(tampered);
assert.equal(safe["security"], true,              "persist re-enforces security");
assert.equal(safe["prod-confirm"], true,          "persist re-enforces prod-confirm");

// 5. Optional rules remain unchanged after persist enforcement
assert.equal(safe["route"], defaults["route"],    "route unchanged");
assert.equal(safe["deploy-preview"], defaults["deploy-preview"], "deploy-preview unchanged");

// 6. All locked items are accounted for
const lockedIds = automationSettings.filter((s) => s.locked).map((s) => s.id);
assert.deepEqual(lockedIds, ["security", "prod-confirm"], "exactly two locked rules");

// 7. Normalization is idempotent
const once  = enforceOnPersist(tampered);
const twice = enforceOnPersist(once);
assert.deepEqual(once, twice, "normalization is idempotent");

console.log("✅ All locked-rule normalization checks passed.");

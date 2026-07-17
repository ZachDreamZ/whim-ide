# Whim Standalone Harness — Design Spec

**Date**: 2026-07-17  
**Status**: Approved  
**Version**: 1

## Objective

Make Whim a fully self-contained coding agent harness by removing all external runtime dispatch (Pi, Codex, Claude, Antigravity, Eve). The native Rust agent loop becomes the only execution path. API key–based provider auth stays as-is; OAuth is a separate follow-up.

## Why

- Eliminates dependency on external CLIs (install, version, auth, credential leaks)
- Simplifies settings, UI, and user mental model
- Whim's native agent is already the default (`"native"`) and is fully functional
- Removes ~800 lines of probe/auth/dispatch code

## Scope

### 1. Type System (`src/lib/bridge.ts`)

**AppSettings.agent** simplifies from:

```ts
runtime: "native" | "pi" | "codex" | "claude" | "antigravity" | "eve";
piModel: string;
externalModel: string;
defaultAdapter: string;
wslDistro: string;
containerImage: string;
remoteHost: string;
```

To:

```ts
// runtime always "native" — field removed, or kept as const
// Drop: piModel, externalModel, defaultAdapter, wslDistro, containerImage, remoteHost
```

**Removed types:**
- `ExternalHarnessStatus` (and all harness-related types)
- `bridge.externalHarnesses()` method
- `bridge.mediaRuntimeStatus()` — its `codexAvailable`/`codexAuthenticated` fields reference Codex

**Default capabilities** — remove `"pi-delegation"` and `"external-harnesses"`.

**Version**: bump `defaultAppSettings.version` from 1 → 2.

### 2. Rust Backend

**Remove `external_harness.rs`** entirely:
- `find_launcher()` — used only by harness probing
- `capture_process()` / `capture_subscription_process()` — harness IPC only
- `probe_version()` — harness version checking
- `ensure_subscription_auth()` — Codex/Claude/Antigravity OAuth verification
- `scrub_provider_credentials()` — credential isolation for external CLIs
- `discover_external_harnesses()` — the Tauri command
- Tests for subscription detection, credential scrubbing

**Remove from `agent.rs`:**
- `find_pi_launcher()`
- `run_pi_agent()` call path (lines ~5233-5265)
- `run_external_agent()` call path (lines ~5204-5231)
- `run_eve_agent()` call path (lines ~5185-5203)
- Auto-fallback to Codex when no provider is found (lines ~5272-5285+)
- `external_harness_enabled()` check
- `pi_delegation_enabled()` check
- References to `runtime` setting in `run_agent_prompt`

**Hosted agent in `reflector.rs`** — remove `JanitorRuntimeRequest` or simplify it (it passes provider/model/key/base_url for the spawned janitor; keep the data but remove the runtime-specific plumbing).

**Remove from `lib.rs`:**
- `backend::external_harness` module declaration
- `discover_external_harnesses` command registration

**Remove from `capabilities.rs`:**
- `"external-harnesses"` entry
- `"pi-delegation"` entry

### 3. Frontend UI

**ConfigurationSettings.tsx:**
- Remove "Execution engine" select (runtime selector)
- Remove Pi model input (was conditional on `runtime === "pi"`)
- Remove external model input (was conditional on codex/claude/antigravity)
- Remove "External harnesses" section (harness cards grid)
- Label changes: "Agent configuration" instead of "Agent runtime"

**CreativeStudio.tsx:**
- Remove `runtime.codexAuthenticated` checks
- Remove Codex subscription readiness display

### 4. Settings Migration

When `settings.version` is 1 (old format):
- Set `runtime` to `"native"` if it was `"pi"`/`"codex"`/`"claude"`/`"antigravity"`/`"eve"`
- Remove `piModel`, `externalModel`, `defaultAdapter`, `wslDistro`, `containerImage`, `remoteHost`
- Bump version to 2

## Non-goals

- No OAuth implementation (separate follow-up)
- No sidecar changes (browser automation, OCR remain)
- No changes to agent loop, tool execution, event streaming
- No changes to provider enum or provider resolution

## Verification

1. TypeScript compiles (`tsc --noEmit`)
2. Lint passes (`eslint`)
3. Tests pass (`vitest run`)
4. Rust compiles (`cargo build`)
5. Existing settings file with `"runtime": "pi"` migrates to native on load
6. UI shows simplified agent config pane (no runtime selector, no harness cards)

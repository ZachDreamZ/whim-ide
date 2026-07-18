# AGENTS.md

Compact guidance for working in this repo. If a fact is obvious from the
filename or standard tooling, it is not listed here.

## What this is

Windows-first **Tauri 2** desktop app: a Rust host (`src-tauri/`) and a React 19 +
TypeScript + Vite + Tailwind v4 frontend (`src/`). The agent chat ("Mission
Control") is the primary surface; there is **no in-app editor** — file browsing is
read-only and the app ships a *demo* chat response in browser mode. The real agent
runs only in the native Windows app.

## Developer commands

- `npm install`
- `npm run dev` — Vite browser dev server on `http://localhost:1420` (needs WebView2
  only for the native app, not for `dev`).
- `npm run tauri dev` — native Windows window (requires Rust MSVC toolchain +
  WebView2; this is the only way to exercise real agent/IPC behavior).
- `npm run build` — runs `tsc` (strict, no-emit) **then** `vite build`. A typecheck
  failure blocks the build.
- `npm run typecheck` / `npm run lint` / `npm test` — separate steps.
- `npm run check` — runs `typecheck && lint && test` in that order. Use this as the
  single pre-push gate.
- `npm run tauri build` — packages Windows installers under
  `src-tauri/target/release/bundle/`.

### Rust (run in `src-tauri/`)
- `cargo check` / `cargo fmt --check` / `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test` — 81 tests. The orchestration lifecycle integration test in
  `backend/orchestration.rs` is **skipped by default**; run it with
  `WHIM_E2E_PROVIDER=...` (plus optional `WHIM_E2E_MODEL`, `WHIM_E2E_WORKSPACE`).
  It needs a WebView2-capable machine and a real provider, so it does not run in CI
  sandboxes.

## Toolchain quirks

- The Rust crate lib is named `workwhim_ide_lib` (the `_lib` suffix is intentional —
  avoids a Windows name clash with the bin, see `src-tauri/Cargo.toml`).
- Vite enforces `strictPort: true` on `1420`; `src-tauri` is ignored by Vite's
  watcher (Rust has its own build). Never run `npm run dev` alongside expecting
  `src-tauri` HMR.
- ESLint uses a pinned flat config (`eslint.config.js`). **Never use `npx eslint` or
  download executables** — background checks rely on the local `npm run lint`.
- TypeScript: `noUnusedLocals`/`noUnusedParameters` are on (strict). Underscore-prefixed
  names (`_foo`) are exempt. `bridge.ts` re-exports `APP_VERSION` — keep it in sync.
- `dompurify` is pinned to `3.4.12` via `overrides` (security). Don't remove it.
- Frontend uses the `@` alias → `src/`. Tailwind v4 via the Vite plugin (no
  `tailwind.config.js`). Heavy Markdown/Shiki assets are lazy-loaded chunks.

## Monorepo / package boundaries

- `src/` — React UI, `src/lib/` bridges to Tauri IPC, `src/components/` surfaces.
- `src-tauri/src/backend/` — all native capability modules (workspace, voice,
  settings, orchestration, deployment, context). `orchestrator.rs` +
  `agent.rs` + `capabilities.rs` own the agent runtime.
- `src-sidecar/` — separate Node package (OCR/sidecar). Not part of the main app
  build; edit independently.
- `scripts/` — `bump-version.mjs` updates version across `package.json`,
  `tauri.conf.json`, `Cargo.toml`, and `src/lib/bridge.ts` atomically. Always use it
  for version bumps. `release.mjs` handles release signing + `latest.json`.

## Architecture facts not obvious from filenames

- The **Rust ledger (`BackendState`/`DurableJobStore`) is the only durable checkpoint
  authority**. LangGraph (`src/lib/mission-graph.ts`) is dynamically loaded and
  refuses to run without a durable Rust ledger record.
- Capabilities (`capabilities.rs`) are the serializable feature catalog; disabling a
  capability removes its tools from the runtime schema — UI toggles change real
  execution.
- Model routing is cost-aware: read-only roles default to `auto/cheap`, coding to
  `auto/coding`. OmniRoute gateway at `127.0.0.1:20128` is preferred in zero-config
  auto-routing when running.
- The `always` approval posture withholds mutation tools until a resumable approval UI
  exists. Janitor background agent edits at most 3 files in a Whim worktree and never
  auto-merges.

## Docs (read before large changes)

`docs/architecture.md`, `docs/ecosystem.md`, `docs/trust-and-automation.md`. The
`handoff.md` at repo root and `.whim/HANDOFF.md` track the latest verified state.

## Verification expectations

A clean change should pass `npm run check` and `cargo test` (native). Expect large
JS bundles (limit raised to 2000 KB) — not a regression. Windows-only paths
(`windows` crate, UI Automation) cannot be exercised in non-Windows sandboxes.

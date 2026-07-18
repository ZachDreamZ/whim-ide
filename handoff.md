# Handoff — Whim IDE

> For a fresh agent session. Read this + `AGENTS.md` (repo root) before doing anything.
> Last updated: 2026-07-18. Repo version: `0.4.7`.

## Repo location (IMPORTANT)

The project now lives at **`D:\whim-ide`**.

It was migrated off `C:` on 2026-07-18 because C: had only ~640 MB free and the
Rust `target/` dir (~20 GB) was filling the disk. A full move was done; the old
`C:\Users\Vendex\Documents\Codex\2026-07-10\ca\work\whim-ide` folder is now empty
and should be ignored/deleted.

Git, working tree, and all history are intact at `D:\whim-ide` (HEAD `26bde6e`,
branch `main`).

## Environment setup (do this first on a fresh machine)

1. **Rust toolchain** — the default may not be set. Run:
   ```
   rustup default stable
   ```
   (seen error `rustup could not choose a version of cargo to run` when unset).

2. **Cargo build output must go to D:** — a global cargo config forces this so C:
   never fills again:
   `C:\Users\Vendex\.cargo\config.toml`:
   ```toml
   [build]
   target-dir = "D:\\cargo-target-whim"
   ```
   If that file is missing, recreate it (or pass `CARGO_TARGET_DIR=D:\cargo-target-whim`).

3. **Node** — standard `node` on PATH. Then:
   ```
   cd D:\whim-ide
   npm install
   ```

4. **Disk space** — C: is small; D: has hundreds of GB. Keep all build artifacts on
   D:. If `cargo test` fails with `os error 112` ("not enough space"), it means the
   target dir landed on C: — fix the cargo config above.

## How to verify a change (pre-push gate)

```
npm run check          # typecheck && lint && test  (frontend; 108 tests pass)
cd src-tauri && cargo check
cd src-tauri && cargo test
```

- Frontend: `npm run check` must be clean (0 lint errors; warnings are pre-existing).
- Rust: `cargo check` clean. `cargo test` → 143/144 pass.
- **One known pre-existing test failure, NOT caused by our changes:**
  `backend::tests::checkpoint_and_rollback_scripts_preserve_branch_and_untracked_files`
  fails in this sandbox (git/PowerShell behavior in the temp repo). Confirmed it fails
  identically on the unmodified baseline via `git stash`. Do not treat it as a
  regression. All other 143 native tests pass.

## What is done (Phase 0 — correctness & safety, no API change)

All six items landed and verified:

1. **Atomic ledger writes** — added `atomic_write_json` + `MAX_LEDGER_BYTES` in
   `src-tauri/src/backend/mod.rs`; `DurableJobStore::save` (`orchestrator.rs`) routes
   through it with a `.bak` fallback. Removed now-unused `io::Write` import.
2. **Dead worker killed** — removed `start_orchestration_worker` from
   `backend/orchestration.rs` and its call in `lib.rs` (`.setup(|_app| Ok(()))`).
3. **Dead frontend state** — removed unused `_entries`/`setEntries` from `src/App.tsx`
   and 3 call sites.
4. **Poisoned-mutex drops surfaced** — `reflector.rs` (verification record + job
   finalize) and `orchestration.rs` (cancellation poll) now log errors instead of
   silently dropping writes.
5. **Blocking I/O off async runtime** — `memory.rs` `get_observational_memory` and
   `backend/mod.rs` `auto_provider` (extracted `probe_local_providers`) now run store
   I/O / TCP probes via `tauri::async_runtime::spawn_blocking`. Call site updated to
   `auto_provider().await` in `agent.rs`. `oauth_authorize` runs its callback listener
   via `spawn_blocking`.
6. **OAuth CSRF state check** — `ExchangeRequest.state: Option<String>` added;
   `oauth_build_auth_url` registers the generated `state` in a new `PENDING_STATES`
   registry (`oauth.rs`); `oauth_exchange` rejects any request whose echoed `state`
   is missing/absent. Note: `oauth_exchange`/`oauth_build_auth_url` are NOT yet wired
   to the frontend — no UI caller exists, so the new required field doesn't break
   anything. `oauth_authorize` (the wired full-flow command) generates its own state
   and calls `exchange_code` directly, so it is unaffected.

### Files touched (Phase 0)
- `src-tauri/src/backend/mod.rs` — `atomic_write_json`, `MAX_LEDGER_BYTES`,
  `auto_provider` async + `probe_local_providers`.
- `src-tauri/src/orchestrator.rs` — atomic save; removed `io::Write` import.
- `src-tauri/src/backend/orchestration.rs` — removed dead worker; `Ok(mut store)` fix;
  cancellation-poll error logging.
- `src-tauri/src/lib.rs` — removed dead worker call.
- `src/App.tsx` — removed dead `_entries`/`setEntries`.
- `src-tauri/src/backend/reflector.rs` — poisoned-mutex error logging.
- `src-tauri/src/memory.rs` — `get_observational_memory` via `spawn_blocking`.
- `src-tauri/src/agent.rs` — `auto_provider().await` call site.
- `src-tauri/src/backend/oauth.rs` — `state` field, `PENDING_STATES`, registry +
  verification; callback via `spawn_blocking`.

These changes are **uncommitted** on `main` (working tree). `package-lock.json` also
shows a 2-line drift from the D: `npm install` (harmless). `AGENTS.md` is a new
untracked file at repo root.

## Next steps (proposed roadmap)

- **Phase 1 (recommended next):** convert `BackendState`'s `std::sync::Mutex` →
  `tokio::sync::Mutex` for true async-safety. This is the largest remaining correctness
  item; it is an API-internal change (affects every `lock(...)` call site in
  `backend/mod.rs` and callers). Plan: grep `backend::mod::lock` usages, convert to
  `.lock().await`, fix `Send`/lifetime issues, verify with `cargo check` + `cargo test`.
- Later phases (from the architecture blueprint at
  `C:\Users\Vendex\.local\share\opencode\plans\whim-ide-architecture.md`): capability
  hardening, IPC permission tightening, frontend/agent-runtime cleanups.

## Gotchas for the next session

- Do NOT run `npm run dev` from the old C: path — the opencode watcher may still hold
  an open handle there. Use `D:\whim-ide`.
- `cargo test` needs the D: target dir (see env setup) or C: runs out of space.
- The `checkpoint_and_rollback_scripts_...` test failure is environmental — ignore it.
- `oauth_exchange`'s new `state` requirement is intentionally un-wired; if you later add
  a frontend OAuth flow, build the auth URL via `oauth_build_auth_url` and echo the
  returned `state` into `oauth_exchange`.
- Keep `dompurify` pinned (`3.4.12`) and never `npx eslint` (use `npm run lint`).

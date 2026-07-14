# Security & Robustness Hardening Report — Whim IDE

Scope: harden the Whim IDE backend (Rust / Tauri) for security and crash-safety
without changing UI/UX. This report documents what was hardened, what is out of
scope, and how it was verified. It contains no secrets, absolute paths, run
identifiers, or port numbers.

## 1. Secret redaction in command output (task-1)

Previously, command stdout/stderr was returned verbatim (only ANSI-stripped).
If a command printed a credential (e.g. `Authorization: Bearer …` or a key in a
log line), that secret reached the UI and the agent unredacted.

- Added `redact_secrets(text)` in `backend/whim_route/credentials.rs`. It matches
  well-known secret shapes: provider key prefixes (`sk-`, `AKIA`/`ASIA`, `gh_`,
  `github_pat_`, `AIza`, `ya29.`, `glpat-`, `glrt-`, `npm_`), private-key PEM
  blocks, `name=value` secret assignments, and `Bearer`/`Basic` auth schemes.
  Benign output (build logs, commit hashes) is preserved.
- Wired into the command-output return paths in `backend/execution.rs`
  (`execute_tracked` stdout/stderr and `quick_capture_*`). Output is redacted
  before it is returned to the UI or the agent. The `redact_key` command already
  redacted whole keys; this extends coverage to free-text output.
- Test: `command_output_secrets_are_redacted`.

## 2. External input / URL validation (task-2)

Provider base URLs were not structurally validated, allowing cleartext HTTP to
non-loopback hosts or URLs smuggling tokens via query strings/fragments.

- Added `validate_provider_base` (agent.rs): enforces `https://` or
  `http://localhost`, rejects cleartext HTTP to non-loopback hosts, rejects query
  strings and fragments (token/param smuggling), and rejects embedded
  credentials. Applied at provider registration and at use.
- Tests: `provider_base_url_rejects_query_fragment_cleartext_and_credentials`,
  `provider_endpoints_enforce_transport_and_locality_boundaries`,
  `omniroute_uses_role_aware_routes_and_secure_bases` (these cover the
  cleartext/loopback/credential rejection assertions).

## 3. Sensitive-tool policy enforced natively (task-3)

The "Sensitive tool policy" (Settings → always / risky) was enforced in the Pi
runtime path but the native harness could present mutation tools regardless.

- Native harness now enforces `settings.agent.approval_policy`: when `"always"`,
  mutation tools (`write_file`, `edit_file`, `run_command`, `checkpoint`,
  `rollback`, `preview`, `tunnel`) are removed from the tool schema presented to
  the model — so a model literally cannot call them. `permits_tool`/`run_tool`
  re-check the policy as defense-in-depth.
- `delegate_task` sub-agents inherit the same `settings`/`profile`, so the policy
  is consistent across recursion. Read-only research sub-agents use a fixed
  read-only tool set.
- Janitor (`spawn_janitor_if_needed`) only runs when policy is `"risky"`.
- Tests: `sensitive_tool_policy_gates_mutation_tools_in_both_modes`,
  `always_approve_policy_withholds_mutating_tools`,
  `read_only_research_jobs_run_beside_the_workspace_writer`. Policy inheritance by
  `delegate_task` is verified by construction (it recurses with the same
  `settings`/`profile`) rather than a dedicated unit test.

## 4. Resolved the unwired provider fallback (task-4)

The WhimRoute layer exposed a `WhimRouter` "fallback" that was never wired to any
caller — dead, unreachable code that implied a safety net that did not exist.

- Removed the dead WhimRoute indirection under `backend/whim_route/`:
  `routing.rs` (`WhimRouter`/`ModelPool`/`PoolModel`), `registry.rs`, `adapters.rs`,
  and `gateway.rs`. Provider selection is now direct through `backend/provider.rs`
  and its adapters. Eliminated the misleading "fallback" and the unreachable code.
- No behavior change on working paths; the registry/adapters paths are unchanged.

## 5. Crash-safe durable retries (task-5)

The durable job store (orchestrator.rs) persisted a verification command to disk
unredacted, and recovery on restart could re-execute work.

- `recover_interrupted_jobs`: on load, `Running` jobs become `Interrupted`
  (history preserved, never auto re-executed). Idempotent across repeated loads.
- Atomic persistence: temp-file write → `sync_all` → rename → `.bak` backup, so a
  crash mid-write cannot leave a torn ledger.
- `schedule_retry`: requires a fresh `operation_id`, rejects duplicate IDs (no
  double ledger entry), enforces the `max_attempts` budget, records prior IDs, and
  applies a bounded backoff (≤ 5 min).
- Fixed the durable-context redaction gap: `record_verification` now redacts the
  verification command (which may embed a secret, e.g. `curl -H "Authorization:
  Bearer …"`) before persisting it to the on-disk ledger — consistent with the
  module's stated contract that it must never become a secret store. `create`
  already redacted intent/workspace/title via `audit_text`.
- Tests: `task_state_survives_reload_and_recovers_running_work`,
  `retries_require_fresh_identity_and_stop_at_the_attempt_budget`,
  `older_ledgers_receive_safe_retry_defaults`,
  `verification_command_secrets_are_redacted_in_durable_ledger`.

## 6. Robustness sweep on security-sensitive paths (task-6)

Audited command execution, credential handling, and routing for dangerous
`unwrap`/`expect`. Findings: the scoped paths were already hardened.

- `backend/execution.rs`: 0 `unwrap`/`expect`, 35 `?`/`map_err` sites; every
  external process spawn/output read is mapped to a `Result`.
- `backend/whim_route/credentials.rs`: keyring access (`Entry::new`,
  `set_password`, `get_password`, `delete_credential`) fully `map_err`-handled;
  the only 4 `.expect()` are on constant `Regex::new()` literals (compile-time
  valid, cannot fail at runtime).
- `agent.rs` `run_tool` (agent command execution): no dangerous unwraps; the
  single `.unwrap()` on the external LLM response is provably guarded by the
  match-arm condition (`if response.text…unwrap_or(false)`), so it only fires
  when the value is `Some`.
- Routing: removed entirely (task-4).
- Remaining `unwrap`/`expect` in the crate are in `#[cfg(test)]` fixture code or
  are serialization-infallible / internally-shaped. No speculative churn applied.

## Verification

- `cargo fmt --check`: clean
- `cargo test --lib`: 94 passed, 0 failed
- `npx tsc --noEmit`: clean
- `npm run build` (tsc + vite build): success

## Scope of this goal's changes (accuracy note)

- This goal modified **only backend Rust source** and this report. The files
  changed by this goal are: `agent.rs`, `execution.rs`, `credentials.rs`,
  `orchestrator.rs`, `backend/mod.rs`, `Cargo.toml`/`Cargo.lock`, `voice.rs`
  (URL-credential validation added to the voice base URL), and the deleted
  `whim_route/{routing,registry,adapters,gateway}.rs`. **No UI/UX source file
  (`App.tsx`, `App.css`, `*.tsx` components, `lib/bridge.ts`, `src-sidecar/*`)
  was modified by this goal.**
- The working tree additionally contains uncommitted UI/voice/benchmark changes
  that **pre-date this goal** (baseline and earlier validation work) and are
  outside this goal's scope. They are not part of the hardening deliverable and
  were not introduced by it.
- Out of scope for this goal: UI/UX polish, frontend component behavior, and
  live packaged-app GUI E2E. Verification is via Rust unit tests that drive the
  actual production functions (`execution.rs`, `credentials.rs`, `agent.rs`,
  `orchestrator.rs`) plus a clean release-capable build, not a GUI launch.

## Environment notes

- No secrets, credentials, absolute paths, run identifiers, or port numbers are
  present in this report or in the changed code.
- The hardening is verified by unit tests that drive the actual production
  functions (command execution, credential redaction, URL validation, policy
  gating, durable retry/recovery) plus a green build chain.

# Whim — Handoff

> Generated 2026-07-12. Snapshot of the Whim agent-coding desktop prototype after the **Phase 1 orchestration foundation** goal. Sources: `docs/roadmap.md`, `docs/product.md`, `docs/architecture.md`, `README.md`, `.pi/codebase-map/MANIFEST.md`.

---

## 1. Project analysis

### 1.1 Identity & thesis
- **Whim** (window still ships titled "Whim IDE" — cosmetic rename not done). A Tauri 2 **Windows desktop app** that is an *intent-to-outcome workspace* for vibe coding, shaped like Codex Desktop / Claude Code Desktop.
- Thesis: the best vibe-coding environment is not an editor with a chat panel — it is a workspace where every consequential action is **observable, attributable, reversible where possible, and exportable as ordinary source/config**.
- The **Whim loop** (product thesis): Express → Manifest → Observe → Steer → Verify → Ship → Learn.
- **Experience modes** (one continuous workflow, not separate products): Vibe (explore/prototype), Build (turn into maintainable software), Ship (release/operate). The native agent also exposes Vibe/Plan/Build/Verify/Review/Ship **agent modes** in Mission Control.
- **Trust & automation**: scoped permissions, context redaction, checkpoints, provenance, budgets, and *accountable* approvals — the agent that creates a production change cannot approve/promote it.

### 1.2 Tech stack
- **Rust backend** (Tauri 2 command surface) + **React 19 / TypeScript / Vite / Tailwind** frontend.
- Native agent harness via **Vercel AI SDK** (`ai ^7.0.19`); PowerShell execution on Windows.
- WebView2 shell. No backend service / no cloud control plane (local-first, exportable).

### 1.3 Architecture
**Backend (`src-tauri/src/`)**
- `lib.rs` — `generate_handler!` registers **31 Tauri commands** across modules.
- `agent.rs` — native agent: `run_agent_prompt`, `run_native_agent`, `run_tool`, `run_research`, event recording. Coupled to `State<'_, BackendState>` / `WebviewWindow<R>` (5 harness fns generic over `R: tauri::Runtime`).
- `backend/` modules: `workspace.rs` (read/write, tree, resolve_agent_workspace, worktrees), `execution.rs` (PowerShell, tracked ops), `provider.rs` (provider/model discovery, tool reports), `deployment.rs` (checkpoint/rollback, local preview, tunnel, deploy preflight), `orchestration.rs` (the 9 orchestration commands + `mod e2e`), `mod.rs` (`BackendState`, operation registry, `record_orchestration_agent_evidence`).
- `orchestrator.rs` — `DurableJobStore` (persists to `%LOCALAPPDATA%\Whim IDE\orchestration\jobs.json` or `WHIM_DATA_DIR`) + `OrchestrationJob` rich camelCase model + `JobMode/JobStatus/JobAction/JobOutcome/JobEvidence`.

**Frontend (`src/`)**
- `lib/bridge.ts` — typed IPC wrapper over Tauri `invoke`. ~9 `orchestration` methods + workspace/provider/deploy/agent surfaces.
- `App.tsx` — top-level hub; renders the active rail view gated on `workspacePath`.
- Components: `MissionControl.tsx` (agent chat + modes), `OrchestrationPanel.tsx` (**new in Phase 1**), `WorkspaceRail.tsx` (nav, incl. `orchestrate`), `AutopilotHub.tsx`, `ShipHub.tsx`, read-only file tree, diff viewer, terminal, session sidebar.

### 1.4 Agent-first redesign (already done, pre-Phase-1)
Removed the IDE surfaces: Monaco `EditorCanvas`, simulated live preview, Workbench hub. Kept: agent chat, diff viewer, terminal, **read-only** file tree, session sidebar, Skills/Ship/Autopilot. File browsing is read-only; no in-app code editing.

---

## 2. Phase 1 status

### 2.1 COMPLETE — orchestration foundation (this goal)
The Rust orchestration backend was upgraded to the `bridge.ts` contract; `OrchestrationPanel` was built on it; an env-gated E2E test was added; the codebase map was regenerated.

| Area | Files | Notes |
|------|-------|-------|
| Orchestration domain model | `src-tauri/src/orchestrator.rs` | `OrchestrationJob` camelCase rich shape: `budget`, `risk`, `operationIds`, `evidence`, `eventCount`, `attempt`, `startedAtMs`/`finishedAtMs`, `nextEligibleAtMs`, `summary`. |
| Durable store | `src-tauri/src/orchestrator.rs` (`DurableJobStore`) | `create/detail/transition/finish/list_for_workspace/retry`, persisted. |
| 9 orchestration commands | `src-tauri/src/backend/orchestration.rs` + `lib.rs` `generate_handler` | `create/list/list_project/get/dispatch/transition/record_verification/finish/retry_orchestration_job`. |
| Orchestration UI | `src/components/OrchestrationPanel.tsx` (13.7K) | Mounted in `App.tsx` (line 17 import, line 332 render) as `orchestrate` rail view. Create+Dispatch flow + live-polled board with status/risk/evidence + pause/resume/cancel/retry. |
| E2E integration test | `src-tauri/src/backend/orchestration.rs` (`mod e2e`) | Env-gated behind `WHIM_E2E_PROVIDER`. Runtime-free: drives real `DurableJobStore` + `BackendState` create→start→finish(terminal) with recorded `JobEvidence`. |
| Codebase map | `.pi/codebase-map/MANIFEST.md` (8.2K) | Full src tree, 9 bridge orchestration methods, 31 backend commands, E2E + WebView2 notes. |

**Verification gates (all green):**
```
cargo check --manifest-path src-tauri/Cargo.toml                       # 0 errors
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings       # no issues
cargo fmt  --manifest-path src-tauri/Cargo.toml --check                # 0 diffs
cargo test --manifest-path src-tauri/Cargo.toml                       # 65 passed (e2e skipped by default)
npm run build                                                        # success
npm test -- --run                                                   # 38 passed (15 files)
WHIM_E2E_PROVIDER=bogus cargo test --manifest-path src-tauri/Cargo.toml --lib orchestration::e2e   # 1 passed
```

### 2.2 Phase 1 Stability & Guards (completed after the foundation goal)
Closed the remaining Phase 1 hardening items via strongly-typed event streaming, browser-mode guards, and component test coverage. Verified: `cargo test` **65 passed**, `npm test` **38 passed (15 files)**, clippy clean, `fmt --check` clean, `npm run build` success.

- **Typed live event streaming & evidence accumulation (backend)** — new `AgentEvent` enum (`Text` / `Reasoning` / `ToolUse` / `Error` / `Progress`) in `agent.rs`; all call sites now emit typed events instead of raw `serde_json::Value`. `append_agent_evidence_for_operation` (`orchestrator.rs`) parses audit labels (`"Completed: "` / `"Tool failed: "`) to accumulate `tool_call_count` / `failed_tool_call_count` / `event_count` live; `finish` merges duration/timeout by max. `background_agent_evidence` simplified to duration/timeout only.
- **`resolve_key` regression guard** — pure function of env/session params; `resolve_key_regression_guard_no_terminal_fallback` enforces it never spawns a terminal CLI or interactive login. Partially addresses the roadmap's terminal-login regression guard.
- **Browser-mode guards (frontend)** — `bridge.isNative()` checks in `OrchestrationPanel`, `AutopilotHub`, `ShipHub`, `EcosystemHub`: non-native (browser preview) mode renders a per-surface warning banner and disables all mutation controls (dispatch/create/deploy/toggles/install). Closes the roadmap's "browser/native capability differences visible" item.
- **Component test coverage** — four new suites: `OrchestrationPanel.test.tsx`, `AutopilotHub.test.tsx`, `ShipHub.test.tsx`, `EcosystemHub.test.tsx` verify native-mode bridge calls and browser-mode banners + disabled controls.

### 2.3 Phase 1 "still required" (from `docs/roadmap.md`) — remaining gap
Of the roadmap's Phase 1 completion list, only one item remains open:
- **Real desktop end-to-end coverage** — only the runtime-free `mod e2e` orchestration test exists (needs WebView2; see §4). The roadmap asks for real desktop E2E to complement the Rust + component tests.
- Everything in Phases 2–5 (see §3) remains unbuilt.

---

## 3. Phases NOT yet done (roadmap)

> Each phase advances only on **real evidence** (reproducible env, attributable change, diff, verification output, approval boundary, recovery story) — not a complete-looking UI.

### Phase 2 — core vibe loop (pending)
1. Extend the text intent brief into useful extraction/review; add **voice, image, URL, Figma, screenshot, document, structured-requirement intake**.
2. Durable **plan + checkpoint** before broad changes.
3. **Live preview canvas** with element selection, annotation, responsive views, visual variants, before/after comparison.
4. **Semantic diffs**: user-facing intent, files, dependency impact, risk, test evidence.
5. Incremental **content/symbol index** (routes, schemas, tests, design tokens, freshness, reviewed project memory).

### Phase 3 — durable agent harness (pending)
- Scheduler, queues, retries, budgets, cancellation, recovery on the task-ledger contract.
- **Specialist roles**: planner, researcher, implementer, reviewer, tester, security reviewer, designer, debugger, release agent.
- Isolated Git worktrees + neutral verifier; **no agent promotes its own production change**.
- Execution adapters: **Windows, WSL, containers, remote runners** (explicit FS/network/process/secret grants).
- Expand `whim.harness.json` restriction profile (env adapters, model policy, recovery, signed profiles, evaluator snapshots).
- Evaluation pipeline (real issue fixtures, greenfield tasks, security cases, trajectory evidence, harness comparisons).

### Phase 4 — full application platform (pending)
- Provider-neutral provisioning: data, auth, storage, queues, cron, email, payments, analytics, env config.
- Versioned **deployment manifest** + adapters (preview, staging, prod, rollback, teardown, domains, health, runtime evidence).
- Real **plugin/MCP runtime**: signed packages, lifecycle, isolated execution, one permission model, version pinning, rollback.
- GitHub issue/PR flows, reviews, team handoffs, comments, shared policies, local-first (no cloud account required).

### Phase 5 — all-around vibe-coding workspace (pending)
- Voice, image, URL, Figma, direct-canvas workflows.
- **PWA, React Native/Expo, Tauri, Android, iOS** delivery on shared tokens + backend contracts.
- Operations: logs, traces, health, incident diagnosis, rollback, release notes, continuously reviewed project knowledge.
- Team/enterprise governance, remote agents, cloud runners, marketplace distribution, outcome benchmarks (quality, safety, portability, recovery, cost).

### Target feature inventory (product.md — full intended surface, mostly unbuilt)
Intent · Workspace (editor/terminal/git/diffs/preview/device/data/logs) · Agents (lead + specialists, worktrees, task graph, background, pause/steer) · Context (code index, architecture map, journeys, decisions, glossary, tokens, memory) · Customization · Models (curated/BYOK/subscription/gateway/enterprise/local + task-aware routing) · Plugins (extensions/MCP/skills/tools/hooks/adapters) · Verification (build/lint/types/tests/browser/a11y/perf/visual/security/dependency) · Deployment (provider-neutral preview+prod, domains, secrets, data, health, rollback) · Trust (scoped perms, redaction, sandbox, checkpoints, provenance, budgets, approvals) · Windows (native dist, WebView2, shells, WSL, notifications, Credential Manager) · Operations (logs/analytics/errors/feedback/incidents/repair/deploy history).

---

## 4. Environment constraints (read before testing)
- **No git repository.** `git status` → `fatal: not a git repository`. Every change is an uncommitted local edit under `C:/Users/Vendex/Documents/Codex/2026-07-10/ca/work/whim-ide`. Recommend `git init` + commit before continuing.
- **WebView2 is NOT available in this sandbox.** `WebView2Loader.dll` absent; `winget install Microsoft.EdgeWebView2Runtime` reports success but deploys no loader. The `tauri::test` harness (`mock_builder`/`get_ipc_response`) cannot load — it crashes the whole cargo test binary on start (`0xc0000139`), which would also break the default green run. That is why the E2E test is **runtime-free** (real store/state) instead of a tauri::test dispatch-vs-real-provider test. On a WebView2-capable machine: enable the `tauri` `test` feature and extend `mod e2e` with the `get_ipc_response` dispatch path.
- **Agent core is runtime-coupled.** `run_agent_prompt` chain takes `State<'_, BackendState>` / `WebviewWindow<R>`. Full headless E2E without a runtime still needs either the tauri::test harness (needs WebView2) or a larger decoupling refactor of the `State`-taking helpers in `agent.rs` / `backend/execution.rs` / `backend/deployment.rs`.

---

## 5. Recommended next steps
1. **Version control:** `git init` and commit the Phase 1 state so progress is recoverable.
2. **Remaining Phase 1 gap — real desktop E2E**: only the runtime-free `mod e2e` orchestration test exists; add real desktop end-to-end coverage (needs a WebView2-capable machine — see §4) to complement the Rust + component suites.
3. **Pick a Phase 2 pillar** (intake expansion, live preview canvas, semantic diffs, or content/symbol index) and open a scoped goal.

---

## 6. Key file pointers
- Backend orchestration: `src-tauri/src/backend/orchestration.rs`
- Domain model/store: `src-tauri/src/orchestrator.rs`
- Backend state: `src-tauri/src/backend/mod.rs` (`BackendState`)
- Command registration: `src-tauri/src/lib.rs` (`generate_handler!`)
- Frontend IPC: `src/lib/bridge.ts`
- UI: `src/components/OrchestrationPanel.tsx`, `src/components/WorkspaceRail.tsx`, `src/App.tsx`
- Map: `.pi/codebase-map/MANIFEST.md`
- Product/roadmap docs: `docs/product.md`, `docs/roadmap.md`, `docs/architecture.md`, `docs/ecosystem.md`, `docs/trust-and-automation.md`
- App docs: `README.md`

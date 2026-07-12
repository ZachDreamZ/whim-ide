# Whim — Codebase Map

Auto-generated map of the Whim agent-coding desktop app (Tauri 2 + React 19 + TypeScript + Vite, Rust backend with Vercel AI SDK agent harness). Regenerated after the Phase 1 orchestration foundation.

> Read this instead of scanning full sources. Frontend IPC is centralized in `src/lib/bridge.ts` (a `call<T>` wrapper over Tauri `invoke`). The Rust backend exposes Tauri commands registered in `src-tauri/src/lib.rs` `generate_handler!`.

## Frontend (`src/`)

### Entry / shell
- `main.tsx` — React root. (Monaco bootstrap removed in agent-first redesign.)
- `App.tsx` — default export `App`. Hub that selects a workspace, renders `WorkspaceRail` + the active view (`MissionControl`/`OrchestrationPanel`/`ShipHub`/etc.), a read-only file viewer, command palette, titlebar.
- `App.css` / `index.css` — theme tokens + agent-first layout.

### Components (`src/components/`)
- `WorkspaceRail.tsx` — `ViewId = "build" | "providers" | "ship" | "orchestrate" | "autopilot" | "verify" | "ecosystem" | "context"`. `WorkspaceRail({active, onSelect, ...})`. Hosts the "orchestrate" nav item (`ListChecks` icon).
- `MissionControl.tsx` — `MissionControl({...})`. Agent chat surface (the primary pane). No longer depends on `preview-region`.
- `OrchestrationPanel.tsx` — `OrchestrationPanel({workspace})`. **New in Phase 1.** Creates tasks (intent, mode, provider, model), dispatches agents via `bridge.dispatchOrchestrationJob`, and polls a live job board with pause/resume/cancel/retry controls. Calls real backend commands.
- `OrchestrationRibbon.tsx` — `OrchestrationRibbon(...)`. Compact orchestration status strip.
- `ShipHub.tsx`, `ProviderHub.tsx`, `AutopilotHub.tsx`, `EcosystemHub.tsx`, `TaskLedger.tsx`, `VerificationCard.tsx`, `ContextIndexCard.tsx`, `IntentBriefCard.tsx`, `WorktreeCard.tsx`, `ProjectSidebar.tsx`, `Titlebar.tsx`, `CommandPalette.tsx`, `BrandMark.tsx`.
- `agent-elements/` — `agent-chat.tsx` (`AgentChat`, `AnAgentChat`), `error-message.tsx`, etc. (shadcn-style agent UI).

### Lib (`src/lib/`)
- `bridge.ts` — generic `call<T>(command, request?)`. Central IPC. **Orchestration methods:**
  - `recordVerificationResult({workspace?, jobId, ...})` → `record_verification_result`
  - `createOrchestrationJob({workspace, intent, title?, mode, operationId?, provider?, model?})` → `create_orchestration_job`
  - `listOrchestrationJobs(workspace)` → `list_orchestration_jobs`
  - `listProjectOrchestrationJobs()` → `list_project_orchestration_jobs`
  - `getOrchestrationJob(workspace, jobId)` → `get_orchestration_job`
  - `transitionOrchestrationJob({workspace, jobId, action})` → `transition_orchestration_job`
  - `finishOrchestrationJob({workspace, jobId, outcome, summary?})` → `finish_orchestration_job`
  - `retryOrchestrationJob({workspace, jobId})` → `retry_orchestration_job`
  - `dispatchOrchestrationJob({workspace, jobId, apiKey?, baseUrl?})` → `dispatch_orchestration_job`
- `bridge.ts` Orchestration types: `OrchestrationJobMode` (vibe/plan/build/verify/review/ship/operate), `OrchestrationJobRisk` (low/medium/high), `OrchestrationJobStatus` (queued/running/paused/interrupted/completed/failed/cancelled), `OrchestrationJobAction` (start/pause/resume/cancel), `OrchestrationJobOutcome`, `OrchestrationJobEvidence` (eventCount/toolCallCount/failedToolCallCount/durationMs/timedOut), `OrchestrationJob` (id/workspace/title/intent/mode/risk/status/budget{maxDurationMs,maxToolIterations,maxAttempts}/operationId/operationIds/provider/model/createdAtMs/updatedAtMs/startedAtMs/finishedAtMs/summary/evidence/eventCount/attempt/nextEligibleAtMs), `OrchestrationJobEvent`, `OrchestrationJobDetail` (job + events).
- `project.ts`, `context-index.ts`, `intent-brief.ts`, `vibe-pipeline.ts`, `workbench.ts` — pure local computation (no IPC). `utils.ts` — shared helpers.

### Types (`src/types/`)
- `workbench.ts` — `PreviewRegionSelection`, `PreviewRegion`, workbench types (UI-only now; no live preview engine).

## Rust backend (`src-tauri/src/`)

### State & store
- `backend/mod.rs` — `BackendState { orchestration: Mutex<DurableJobStore>, operation_registry: Mutex<HashMap<String, ...>>, ... }` (Tauri managed state). Re-exports request/result types + helper fns (`pub(crate) use`).
- `backend/orchestration.rs` — `DurableJobStore` persists jobs to JSON. `OrchestrationJob` is serialized in the rich camelCase shape the bridge expects.

### Orchestration commands (the 9, in `backend/orchestration.rs`, registered in `lib.rs`)
1. `create_orchestration_job(state, request)` → `OrchestrationJob` (request: workspace, intent, title?, mode, operation_id?, provider?, model?, max_duration_ms?)
2. `list_orchestration_jobs(state, request)` → `OrchestrationJob[]` (request: workspace)
3. `list_project_orchestration_jobs(state)` → `OrchestrationJob[]` (selected workspace fallback)
4. `get_orchestration_job(state, request)` → `OrchestrationJobDetail` (request: workspace, job_id)
5. `transition_orchestration_job(state, request)` → `OrchestrationJob` (request: workspace, job_id, action)
6. `record_verification_result(state, request)` → `OrchestrationJob`
7. `finish_orchestration_job(state, request)` → `OrchestrationJob` (request: workspace, job_id, outcome, summary?)
8. `retry_orchestration_job(state, request)` → `OrchestrationJob` (request: workspace, job_id)
9. `dispatch_orchestration_job(window: WebviewWindow, state, request)` → `OrchestrationJob` (request: workspace, job_id, api_key?, base_url?). Spawns a background task that calls `run_agent_prompt` and records bounded evidence via `background_agent_evidence`.

### Other backend commands (registered in `lib.rs`)
- workspace: `read_workspace_file`, `write_workspace_file`, `select_workspace`
- execution: `run_powershell_command`, `cancel_operation`, `list_active_operations`
- provider: `discover_environment`, `discover_credential_names`, `discover_local_ai_providers`, `discover_providers`
- deployment: `list_git_worktrees`, `create_git_worktree`, `inspect_worktree_candidate`, `discover_verification_plan`, `deploy_preflight`, `deploy_workspace`, `workspace_checkpoint`, `workspace_rollback`, `install_dependencies`, `start_local_preview`, `start_tunnel`
- `agent.rs` — `run_agent_prompt(window, state, AgentRunRequest)` → `AgentRunResult` (the native agent harness; `AgentRunRequest`: prompt/workspace/provider/model/api_key/base_url/agent/session_id/operation_id/timeout_ms/auto_approve/auto_approve_confirmed/auto_continue). Internals: `run_native_agent`, `run_tool`, `run_research`, `record_agent_event`, `emit_agent_progress`.

## Verification gates (all green)
- `cargo check`, `cargo clippy -- -D warnings`, `cargo fmt --check`, `cargo test` (62 passed, 3 suites).
- `npm run build`, `npm test` (31 passed, 11 files).
- E2E dispatch test (env-gated, `WHIM_E2E_PROVIDER`): **committed** as a runtime-free integration test in `backend/orchestration.rs` (`mod e2e`). It drives the real `DurableJobStore` + `BackendState` through create → start → finish (terminal) with recorded `JobEvidence`, asserting terminal status + persisted evidence. Default `cargo test` skips it (63 passed). Run with `WHIM_E2E_PROVIDER=bogus cargo test --lib orchestration::e2e` to exercise it.
- The full agent-dispatch-vs-real-provider path (`dispatch_orchestration_job` spawning `run_agent_prompt`) requires a live Tauri runtime (WebView2Loader.dll) and provider credentials. `tauri::test` (`mock_builder`/`get_ipc_response`) is the intended harness, but it cannot load in this sandbox because `WebView2Loader.dll` is absent and `winget install Microsoft.EdgeWebView2Runtime` no-ops. On a WebView2-capable machine, enable the `tauri` `test` feature and extend `mod e2e` with the `get_ipc_response` dispatch path.

## Notes
- IDE surfaces (Monaco `EditorCanvas`, simulated live preview, Workbench hub) were removed. Remaining: agent chat, diff viewer, terminal, read-only file tree, session sidebar, Skills/Ship/Autopilot.
- Agent core (`run_agent_prompt` chain) is coupled to Tauri `State<'_, BackendState>` / `WebviewWindow<R>` (the 5 harness fns are generic over `R: tauri::Runtime` so they are `MockRuntime`-compatible); headless E2E without a runtime requires either the `tauri::test` harness (needs WebView2) or a larger decoupling refactor of the `State`-taking helpers.

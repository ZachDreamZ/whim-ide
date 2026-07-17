# Multi-Agent Orchestration Engine — Implementation Plan

## Files to Create

| File | Purpose |
|---|---|
| `src-tauri/src/backend/orchestration/scheduler.rs` | Provider pool, round-robin assignment, rate limiting |
| `src-tauri/src/backend/orchestration/decomposer.rs` | Intent → sub-tasks via cheap model call |
| `src-tauri/src/backend/orchestration/recovery.rs` | Retry logic, fallback chain |

## Files to Modify

| File | Change |
|---|---|
| `src-tauri/src/orchestrator.rs` | Add SubTask, SubTaskStatus, ProviderPoolEntry, SubTaskEvent types |
| `src-tauri/src/backend/orchestration.rs` | Parallel dispatch: fan-out + fan-in with gather |
| `src-tauri/src/backend/mod.rs` | Register new modules |
| `src-tauri/src/agent.rs` | Decomposer node (auto), synthesizer node (auto) |
| `src-tauri/src/lib.rs` | Register new Tauri commands |
| `src/lib/bridge.ts` | New types + bridge methods for sub-tasks, pool status |
| `src/lib/mission-graph.ts` | Branching graph: parallel execute → gather → synthesize |
| `src/components/OrchestrationPanel.tsx` | Sub-task DAG view, pool status section |
| `src/components/MissionControl.tsx` | Streaming updates from parallel agents |
| `src/components/ProviderHub.tsx` | Pool status indicators per provider |
| `src/App.css` | New styles for sub-task DAG, pool cards |

## Implementation Order

### Task 1: SubTask + ProviderPool types (orchestrator.rs)
- Add `SubTaskStatus` enum (Pending, Ready, Running, Completed, Failed, Cancelled)
- Add `SubTask` struct with id, parent_job_id, description, deps, provider, model, attempt, result, evidence
- Add `SubTaskEvent` struct
- Add `ProviderPoolEntry` struct with provider, model, status, concurrency, consecutive_failures
- Add `OrchestrationPoolStatus` struct for UI
- Keep all in `orchestrator.rs` with existing types

### Task 2: Scheduler module
- `ProviderPool::new(discovered_providers)` — builds pool from ProviderHub discovery
- `ProviderPool::next_ready()` — round-robin: returns next available (provider, model) 
- `ProviderPool::mark_busy(id)`, `mark_failed(id)`, `mark_available(id)`
- `ProviderPool::status_snapshot()` — for UI polling
- Rate limit tracking: if 429, set cooldown timer

### Task 3: Decomposer module
- `decompose_intent(intent, available_providers)` — calls the cheapest available model (by default) with a prompt asking it to split the work
- Returns `Vec<SubTask>` parsed from structured output
- Prompt: "Given this task and available providers, break it into parallel sub-tasks with dependencies. Respond with JSON array."
- No deps = parallel. Deps = sequential chain.

### Task 4: Parallel dispatch (orchestration.rs)
- `dispatch_multi_agent_job` — new Tauri command
- Creates the parent job in ledger
- Calls decomposer to get sub-tasks
- For each ready sub-task: spawn tokio task with its own provider+model+operation_id
- Track all children in a `JoinSet`
- On completion of each: update sub-task status, schedule next ready
- On failure: call recovery, retry if budget allows
- Cancel all children if parent cancelled

### Task 5: Recovery module
- `recover_sub_task(failed_sub_task, provider_pool)` → `Option<(provider, model)>`
- If failed sub-task has remaining attempts < max_attempts, pick next provider from pool
- If no fallback available, mark as Failed with evidence
- Max 2 retries per sub-task

### Task 6: Synthesizer node
- `synthesize_results(intent, sub_tasks)` — calls Vibe model to merge sub-task results
- Prompt: "Given the original intent and results from N agents working in parallel, produce a coherent summary."
- Returns final summary string stored in parent job

### Task 7: Bridge types + commands (TypeScript)
- Add `SubTaskSummary`, `PoolStatus`, `MultiAgentJobRequest` types
- Add `dispatchMultiAgentJob`, `listPoolStatus`, `getSubTaskDetail` bridge methods
- Add `multiAgentEvents` streaming support

### Task 8: mission-graph.ts branching
- Replace linear graph with fan-out → gather → synthesize
- New `decompose` node calls decomposer
- New `parallelExecute` node fans out to N parallel runs
- New `synthesize` node merges results

### Task 9: UI updates
- OrchestrationPanel: show sub-task DAG (tree of sub-tasks with status per provider)
- ProviderHub: pool status section showing which providers are busy/idle
- MissionControl: streaming events tagged with sub-task id

### Task 10: Polish + error edge cases
- Handle empty intent edge case
- Handle all-providers-failed scenario
- Handle single-provider fallback (no parallelism possible, just one agent)
- Loading states in UI during decomposition phase

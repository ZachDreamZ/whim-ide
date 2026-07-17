# Multi-Agent Orchestration Engine — Design

## Problem

Whim's orchestration runs one agent at a time on one provider/model. When the user submits an intent, only one model works while all other configured providers sit idle. If that run fails, the task is dead unless manually retried.

## Goals

1. **Vibe decomposes** the intent into parallel sub-tasks automatically
2. **All providers/models stay busy** — every available model gets a work item
3. **Error recovery** — failed sub-tasks re-route to another provider/model
4. **Synthesis** — results merge into a coherent outcome

## Architecture

```
                    ┌──────────────┐
                    │  User Intent │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Decomposer  │  (Vibe / cheapest model)
                    │  "split this │   analyzes intent, produces
                    │   into N     │   task DAG with deps)
                    │   parallel   │
                    │   work items"│
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Scheduler   │  Maps work items to available
                    │              │  provider+model combos.
                    │              │  Round-robin across all ready
                    │              │  providers. Each work item gets
                    │              │  a provider, model, budget.
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Dispatcher  │  Fires N parallel tokio tasks.
                    │              │  Each runs run_agent_prompt
                    │              │  with its own provider/model.
                    │              │  Cancellation is coordinated.
                    └──────┬───────┘
                           │
               ┌───────────┼───────────┐
               ▼           ▼           ▼
         ┌─────────┐ ┌─────────┐ ┌─────────┐
         │ Agent 1 │ │ Agent 2 │ │ Agent N │
         │ (GPT)   │ │ (Grok)  │ │ (Local) │
         └────┬────┘ └────┬────┘ └────┬────┘
              │           │           │
         ┌────▼───────────▼───────────▼────┐
         │      Gather & Recover           │
         │  - Collect results              │
         │  - Retry failures on diff model │
         │  - Max 2 retries per sub-task   │
         └───────────────┬─────────────────┘
                         │
                  ┌──────▼──────┐
                  │  Synthesizer│  (Vibe model) merges sub-task
                  │             │  results into final output.
                  │             │  Resolves conflicts, fills gaps.
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │  Finalize   │  Persist outcome, evidence.
                  └─────────────┘
```

## Key Components

### 1. Decomposer (Rust `agent.rs` + new `orchestration/planner.rs`)
- Before any agent runs, Vibe/cheapest model analyzes the intent
- Output: `Vec<SubTask>` where each has: `id, description, deps: Vec<SubTaskId>, provider_hint: Option<String>, model_hint: Option<String>`
- Tasks with no deps are parallel-ready
- Tasks with deps wait for their dependency chain

### 2. Scheduler (Rust `orchestration/scheduler.rs`)
- Maintains a `ProviderPool`: list of `(provider, model, status)` per configured provider
- Round-robin assignment: each ready sub-task gets the next available provider+model
- If a provider has `max_concurrent`, the scheduler respects it
- The user's "auto" setting expands to all available providers

### 3. Parallel Dispatcher (Rust `backend/orchestration.rs`)
- Instead of `dispatch_orchestration_job` spawning ONE background task, the new dispatcher spawns N
- Each sub-task gets its own `operation_id`, `provider`, `model`
- All share the parent `job_id` for tracking
- Cancellation: cancelling the parent cancels all children
- Worker coordination via shared state: children complete -> scheduler picks next ready

### 4. Error Recovery (Rust `orchestration/recovery.rs`)
- On sub-task failure: check remaining budget (max 2 retries)
- Pick next available provider+model from pool
- If no fallback, mark sub-task as `failed` with evidence
- Parent task outcome = partial success if <= 30% sub-tasks failed

### 5. Synthesizer (Rust `agent.rs` + mission-graph.ts)
- When all sub-tasks complete (or terminal set reached), Vibe model merges results
- Resolves conflicts, fills gaps, produces final summary
- Stored as job.evidence in the durable ledger

## Provider Pool Management

Each provider in the pool has:
```
struct PoolEntry {
    provider: String,
    model: String,
    label: String,
    status: Available | Busy(operation_id) | RateLimited(retry_at) | Failed,
    concurrency: usize,       // max parallel (1 for most, >1 for API-based)
    started_at: Option<Instant>,
    consecutive_failures: u32,
}
```

- ProviderHub already discovers available providers
- New: expose the pool status in the UI ("3 workers active across 2 providers")
- Rate-limited providers get a backoff window

## Error Handling Rules

| Failure Type | Action |
|---|---|
| Agent run error (model crashed) | Retry on next available provider+model |
| Rate limited (429) | Backoff 30s, try another provider first |
| Timeout | Retry with shorter budget, different model |
| 3 consecutive failures on same provider | Mark provider degraded, exclude from pool |
| All providers failed | Task failed with summary of which providers failed |

## Frontend Changes

- **OrchestrationPanel** — shows parallel sub-task DAG (not just one task)
- **MissionControl** — streaming updates from each sub-task
- **ProviderHub** — pool status: which providers are busy, which are idle
- **OrchestrationRibbon** — shows parallel stage: "3 agents working"

## Backend Changes Summary

| File | Change |
|---|---|
| `src-tauri/src/backend/orchestration.rs` | Parallel dispatch, sub-task ledger, gather |
| `src-tauri/src/orchestrator.rs` | `SubTask`, `SubTaskStatus`, pool state |
| `src-tauri/src/backend/orchestration/scheduler.rs` (new) | Provider pool, round-robin, rate limiting |
| `src-tauri/src/backend/orchestration/recovery.rs` (new) | Retry logic, fallback chain |
| `src-tauri/src/agent.rs` | Decomposer node, synthesizer node |
| `src/lib/mission-graph.ts` | Branching graph (fan-out, fan-in) |
| `src/components/OrchestrationPanel.tsx` | Sub-task DAG view |
| `src/components/ProviderHub.tsx` | Pool status indicators |
| `src/lib/bridge.ts` | New sub-task types, pool status |

## Priority: Correctness > Throughput > Polish

1. First: decomposer + parallel dispatch (single provider, multiple models)
2. Second: cross-provider scheduling
3. Third: error recovery + retry
4. Fourth: synthesis
5. Fifth: UI polish

# Whim transformation roadmap

Whim is becoming an intent-to-outcome workspace, not a chat pane attached to an editor. Its defining contract is simple: every consequential action must be observable, attributable, reversible where possible, and exportable as ordinary source code and configuration.

## Delivery language

- **Implemented** means code runs through the native Tauri bridge and is covered by an appropriate check.
- **In progress** means the data contract and a user-visible path exist, but the broader lifecycle is not complete.
- **Planned** means it is an explicit product commitment, not a simulated success state.

## Research adaptations

Whim takes ideas from the referenced projects without inheriting a hosted control plane or a single-provider dependency.

| Reference | Adaptation in Whim | Boundary |
| --- | --- | --- |
| [MetaHarness](https://github.com/SuperagenticAI/metaharness) | Versioned harness profiles, run evidence, evaluation matrices, and candidate comparison | Whim will optimize instructions, setup, validation, routing, and recovery as executable harness assets—not just prompts. |
| [OpenHands runtime architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime) | A strict execution-adapter boundary for native, WSL, container, and remote runners | The current native executor is not yet a sandbox. Container/remote runners must remain separately labeled and policy-governed. |
| [Aider](https://github.com/Aider-AI/aider) | Incremental repository maps, Git-native review, and verification after edits | Repository context must stay inspectable and selectively retrieved rather than silently becoming an opaque model cache. |
| [h5i](https://h5i.dev/manual/) | Isolated worktrees, evidence-backed review, policy files, and neutral verification | Whim will preserve ordinary Git workflows; audit metadata is local-first and exportable rather than a SaaS prerequisite. |
| [OpenCode](https://github.com/anomalyco/opencode) | Provider-neutral model/provider selection and local workflows | Whim keeps its native product boundary and must not fall back to noisy terminal-based provider login without an explicit user request. |

## Phase 1 — stabilize the prototype

### Implemented in this slice

- Durable local task ledger in `%LOCALAPPDATA%\Whim IDE\orchestration\jobs.json` (or beneath `WHIM_DATA_DIR` for development), with a FIFO writer slot per execution target and a visible running/queued/held roster.
- Jobs are created before native agent execution, include an explicit mode, derived risk label, fixed timeout and three-attempt budgets, model/provider identifiers, bounded event counts, and a local audit timeline. Failed or interrupted work can be scheduled for a bounded retry with a fresh operation identity and an optional local backoff; older ledgers receive safe migration defaults.
- Native runs append a bounded fixed-label tool trace as each tool result arrives (for example, a workspace edit or verification command succeeded/failed). It is written by the native harness and tied to the exact running operation, rather than trusting a browser-rendered session.
- API keys, prompts, command text, file paths, and raw tool output are deliberately excluded from the ledger; assignment-style secrets in persisted intent are redacted.
- Running work is marked **interrupted** after an app restart instead of being displayed as a completed task.
- Mission Control shows the current/recent task record, attempt budget, selected task evidence, and an explicit retry action for eligible failed/interrupted attempts. If the app exits after that attempt is queued but before execution starts, the durable roster offers an explicit **Run queued attempt** action after restart. Both paths use the redacted durable context, resolve credentials only from the current session/environment, and re-enter the native mode and registered-worktree checks.
- Any eligible queued task can be explicitly dispatched to a native background future while Whim remains open. Dispatch atomically claims the FIFO target slot, returns control to Mission Control, records fixed-label progress through the native harness, polls the durable result, and exposes cancellation by exact operation ID. Ephemeral credentials are moved only into that future and are never written to the task ledger.
- Agent request timeouts are clamped between 15 seconds and 30 minutes at the Rust boundary.
- A user-editable, portable intent brief is stored as `.whim/intent-brief.json` in the ordinary project. It captures goal, users, constraints, acceptance criteria, design direction, integrations, and risks, then becomes explicitly labeled descriptive context for future agent tasks.
- A bounded repository context inventory identifies project rules, architecture, routes, schemas, tests, docs, design-system, and deployment paths. It reports freshness, an approximate prompt-token footprint, and sensitive-path omissions; the agent receives the same path-only inventory that the user can inspect.
- The native harness now treats repository memory, comments, URLs, tool output, and project instructions as untrusted lower-priority context. They can inform conventions but cannot override permissions, safety policy, or the current user request.
- Git checkpoints now require an existing repository with a committed `HEAD`. They use a temporary index and `refs/whim/checkpoints/latest`, preserving the user's branch, real index, config, and untracked files; rollback restores tracked files and reports whether current tracked work was placed in a local stash.
- The browser preview labels task and brief persistence as unavailable instead of manufacturing local state. The installed Windows app is the only execution/persistence path for these capabilities.
- A Vitest + Testing Library baseline covers pipeline transitions, workspace command helpers, untrusted agent-event rendering, durable evidence counts, the task-ledger boundary, and intent-brief normalization/persistence UI.
- Preview now supports a real click-to-mark region annotation. It records bounded viewport coordinates, shows the marker, and sends coordinate-only context to a later agent task; it explicitly does **not** claim cross-origin DOM-element inspection or screenshot capture.
- Git worktrees are now a real native execution target: Whim lists Git's registered worktrees, creates a new branch under a managed sibling directory, validates that an agent target belongs to the selected repository, and pins the task ledger to that exact target. The agent's file tools, commands, checkpoints, previews, tunnels, memory, and search all use that resolved root.
- A read-only candidate review compares a registered non-primary worktree with the primary worktree using Git's real `HEAD` and merge-base. It reports bounded committed/working paths, dirty-state blockers, sensitive/auth/schema/deployment/dependency risk signals, and the fixed verification entry points available in the candidate. Inspection refuses to snapshot a worktree while an agent is actively writing it and does not expose merge controls yet.
- `whim.harness.json` is an optional, portable profile that can only tighten the native harness. It can remove tools, restrict direct write/edit prefixes, and lower tool/time budgets; malformed profiles fail before provider discovery. See [harness profiles](./harness-profile.md).
- Native agent events now stream back to the originating Whim window while a run is active. The UI shows a bounded live activity rail and reconciles to the final command result; live-only progress messages never replace or fabricate final tool evidence.
- A neutral verification card now detects a conservative fixed set of package, Cargo, Python, and .NET entry points in the exact execution target. It displays the command and source, runs only after an explicit click, supports cancellation of the active check, and retains bounded visible output as evidence. Project script bodies are never interpolated into shell commands during discovery.
- Mission Control now exposes Vibe, Plan, Build, Verify, Review, and Ship modes. Plan and Review have native read-only tool boundaries; Verify has no file-write or generic shell tool and accepts only the same fixed commands discovered by Whim's verification planner. Unknown native modes fail before provider discovery instead of silently becoming Vibe runs.

### Implemented Phase 1 Finalization Items

- Split `backend.rs` and `agent.rs` into workspace, execution, provider, deployment, and orchestration modules. (Completed)
- Expanded frontend unit/component coverage and mock-based capability coverage to complement Rust tests. (Completed)
- Replaced post-hoc event collection with typed live event streaming and stable event-contract regression tests. (Completed)
- Implemented and verified a regression guard against terminal-launch provider login. (Completed)
- Made browser/native capability differences visible on every affected action with banners and disabled controls. (Completed)

### Current ledger boundary

The ledger persists task intent, attempt identities, eligibility time, and outcomes, not a resumable provider conversation or credentials. Mission Control can explicitly schedule and execute an eligible retry, dispatch a queued task in the native background while the app stays open, and recover a queued-but-not-started retry after restart. Whim does not yet run a separate headless worker after the desktop process exits or resume an in-flight provider request after restart; such a run is recovered as interrupted. It also does not sandbox arbitrary code or grant per-tool approval yet. A user launching, retrying, or background-dispatching the current native agent grants a workspace-scoped, run-level authorization; destructive commands and public/production actions remain blocked in the native agent boundary. Future approval work must tighten this model, never describe it as stricter than it is.

### Current intent-brief boundary

The intent brief is a user-authored text form, not an LLM-generated requirements analysis, voice/image/URL/Figma intake, or collaboration artifact. It is deliberately saved as ordinary JSON under `.whim` so it can be reviewed, versioned, edited, or removed outside Whim. Obvious assignment-style secrets are redacted before this file is written, but users should never place credentials in project briefs.

### Current preview boundary

The implemented visual feedback path is a user-selected coordinate annotation, not DOM inspection. Cross-origin previews cannot safely expose arbitrary element trees to the desktop shell, so Whim captures no element selector, page text, or screenshot and says so in the agent context. Same-origin inspection, screenshot annotations, semantic element mapping, responsive presets, visual variants, and visual regression remain planned work.

### Current checkpoint boundary

Checkpoints are Git-backed and intentionally do not create a repository for the user. They snapshot tracked files only, so a newly created untracked file will not be rolled back automatically; that is shown in the agent tool contract rather than hidden. Broader cross-platform snapshotting and user-facing checkpoint history remain planned.

### Current worktree and profile boundary

Whim can create and target real Git worktrees, and the task ledger, intent brief, automation policy, context inventory, native memory, file reads/writes, commands, and user-invoked verification are all scoped to that validated target. The durable scheduler and native operation registry both grant one active agent writer per resolved target: queued tasks are FIFO, a second autonomous writer is rejected in the same worktree, and distinct targets remain independently runnable. Mission Control aggregates task ownership across Git's registered worktrees and labels each task with its target. It can inspect candidate revisions, dirty state, risk, and available verification commands, but it does not yet execute a complete candidate verification suite, persist those results as a promotion gate, merge a candidate, or automatically remove a worktree. The worktree selector intentionally disables target changes during a foreground run. A harness profile restricts Whim's own file tools and tool availability; it is not a container, network policy, or complete shell sandbox. To prevent shell writes, projects must omit `run_command` and `verify` from their profile as well as narrowing direct file paths.

### Current verification boundary

Verification discovery recognizes a small fixed list of conventional commands and does not read or execute arbitrary script bodies until the user explicitly clicks a displayed command. The native Verify agent mode uses that same allowlist after the user explicitly starts a Verify task; it cannot issue a generic shell command or edit files. This is still a local native process check, not a browser, accessibility, security, visual-regression, migration-safety, or deployment verifier. A passed package script remains evidence of that script's result, not a guarantee that every user journey or production environment is correct.

## Phase 2 — core vibe loop (Chat-First & Canvas-First)

Build the loop that moves from a vague request to a reviewable, working preview, integrating deeply with the ChatGPT-style interface:

1. **Multimodal Attachment Menu**: Extend the input bar with a `+` attachment menu to support image, URL, Figma, document, and structured-requirement intake directly into the chat context.
2. **Context-Aware Mentions**: Expand the initial path inventory into a `@workspace` and `@file` mention system in the chat input for instant semantic index retrieval.
3. **Canvas Enhancements**: Expand the split-pane Canvas with visual variants, before/after layout comparisons, and deeper semantic diffs.
4. **Durable Planning**: Create a durable plan and checkpoint before broad changes, exposed as a "Plan" step in the Data Analysis block.

## Phase 3 — durable agent harness

- Scheduler, queues, retries, budgets, cancellation, and recovery built on the task ledger contract.
- Specialist roles: planner, researcher, implementer, reviewer, tester, security reviewer, designer, debugger, and release agent.
- Isolated Git worktrees with a neutral verifier; no agent promotes its own production change.
- Execution adapters for Windows, WSL, containers, and remote runners, each with explicit filesystem, network, process, and secret grants.
- Expand the implemented per-project `whim.harness.json` restriction profile with environment adapters, model policy, recovery procedures, signed reviewed profile changes, and evaluator-visible profile snapshots.
- Evaluation pipeline using real issue fixtures, representative greenfield tasks, security cases, trajectory evidence, and harness variant comparisons.

## Phase 4 — application platform (Integrated Chat Workflows)

Heavy platform features exposed naturally through the chat and Canvas interface:

- **Dynamic Search & Analysis**: Real plugin/MCP runtime powering the Search and Data Analysis blocks. The agent can dynamically load plugins (e.g., database clients, auth providers) and render results natively in the chat.
- **Canvas "Ship It" Deployments**: Versioned deployment manifest plus adapters (preview, staging, production) executed via a "Ship It" button directly in the Canvas Workspace.
- **GitHub Integrations**: PR flows, reviews, and team handoffs managed via chat commands and Canvas comments, avoiding complex DevOps dashboards.
- Provider-neutral backend/service provisioning (data, auth, storage) via chat-driven scaffolding.

## Phase 5 — all-around vibe-coding workspace

- **Flawless Voice Mode**: Perfect the real-time Voice Orb experience for hands-free local coding.
- **Deep Research Subagents**: Scale the researcher mode to spawn and visualize dozens of parallel subagents for massive codebase refactors.
- Multi-platform delivery (PWA, React Native/Expo, Tauri, Android, iOS) using shared tokens and backend contracts.
- Operations tooling: logs, traces, and incident diagnosis streamed directly into the Data Analysis block for real-time debugging.

## Success gates

No phase advances because the UI looks complete. It advances only when the relevant path has real evidence: a reproducible environment, an attributable change, a diff, verification output, a clear approval boundary, and a recovery story.

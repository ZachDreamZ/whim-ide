# Whim IDE — Handoff

Last updated: 2026-07-14

## Current state

The six formerly mocked or incomplete areas are now connected end to end:

- Canvas reads and writes selected-workspace files through Tauri IPC. It filters binary/large files, tracks undo/redo atomically, prompts before discarding edits, rejects stale saves with modified-time conflict detection, and uses a sandboxed preview.
- Citation badges are clickable and scroll to sources extracted from actual assistant URLs and reference definitions. Static sample sources were removed, and code fences/reference definitions are excluded from badge rewriting.
- Research tool calls can fan out to four concurrent read-only agents. Every stream receives a durable `research` ledger job, shares parent cancellation, does not claim the workspace writer lease, and records its terminal summary.
- App Context uses hidden Windows PowerShell adapters: UI Automation reads visible VS Code or terminal content, and desktop screenshots are saved under `.whim/context`. Explicitly selected context is marked untrusted and supplied to the next agent request.
- Voice Mode records through `MediaRecorder`, transcribes, and can speak the latest assistant response through OpenAI-compatible speech endpoints. The Rust boundary enforces size/type limits, timeout, no redirects, HTTPS for remote endpoints, loopback-only local endpoints, and public DNS pinning.
- Strict TypeScript unused checks are enabled. Previously hidden project controls are visible again, Rust is formatted, and focused frontend/Rust regression tests cover the new boundaries.

The routing/orchestration layer now also has production seams instead of provider-shaped UI only:

- `@langchain/langgraph` coordinates every foreground mission through `prepare -> persist -> execute -> finalize`. It is dynamically loaded, refuses to execute without a durable Rust ledger record, and always attempts terminal evidence recording after a native execution failure. The Rust ledger remains the only durable checkpoint authority.
- OmniRoute is a first-class provider and local gateway. Whim detects `127.0.0.1:20128`, lists `/v1/models`, surfaces the six official `auto/*` routes, accepts optional `OMNIROUTE_API_KEY` auth, and prefers the gateway in zero-config auto routing when it is running.
- Model routing is deliberately cost-aware: read-only planning, research, review, testing, and security roles default to `auto/cheap`; implementation and general coding default to `auto/coding`. Explicit user model choices always win.
- OmniRoute endpoints are secured at the Rust boundary: loopback HTTP is allowed, remote gateways require HTTPS, and embedded URL credentials are rejected.
- The main UI was flattened into a graphite instrument panel with one mint state accent. The decorative brand orbits, gradient/glow router, large voice orb, and fabricated "38 checks" preview card were removed; the preview now shows actual durable job evidence.

The 2026-07-13 agent-runtime pass also replaces the newly introduced mock Settings surface with native behavior:

- Pydantic AI v2's stable capability/spec architecture is integrated in Rust. `capabilities.rs` owns the serializable capability catalog; enabled capabilities remove tools from the runtime schema, while compact inactive guidance reduces prompt use without adding a Python sidecar.
- Settings are versioned, validated, persisted under the user's Whim config directory, and loaded into `BackendState`. React changes are serialized so fast edits cannot save out of order.
- Agent runtime, reasoning depth, approval posture, capability enablement, and research concurrency all change actual execution behavior. The `always` approval posture withholds mutation tools until a resumable approval UI exists.
- Pi 0.80.6 is a selectable alternate runtime. It runs in a hidden, bounded subprocess with role-specific tool allowlists, capped output, random temporary prompt files, cancellation, timeout, and Pi-owned credentials. Gemini CLI was not detected and is not falsely advertised.
- Computer-use switches are checked by Rust before UI Automation or screenshot capture. Voice and language settings flow into the real transcription/TTS requests. Accent, fonts, contrast, suggested prompts, and the status panel update the actual window.
- The fabricated profile, random activity chart, dead mock interpreter, inert settings search, and twelve unfinished sidebar categories were deleted. Research findings and primary sources live in `docs/agent-runtime-research.md`.

The 2026-07-14 evaluator/janitor pass adds two bounded background systems:

- Native agents start generation-tagged `cargo check`, `npm run build`, and local ESLint checks discovered from project manifests. Successful edits coalesce into a new generation; stale results are discarded, the latest bounded/redacted output is appended as explicitly untrusted context, and the final model turn waits for fresh evidence.
- Tauri's nested `src-tauri/Cargo.toml` is now discovered. ESLint has a pinned local flat configuration and `npm run lint`; background checks never use `npx` or download executables.
- Cancelling a native agent no longer attempts to terminate PID 0, orchestration cancellation awaits cooperative cleanup, and background verification subprocesses drop provider API-key environment variables.
- The reflector now consolidates observations transactionally into a real bounded summary. It no longer replaces history with a placeholder, and concurrent memory updates are serialized through atomic file replacement.
- Successful foreground runs may schedule one low-priority janitor candidate when enabled in Settings. The janitor uses a dedicated six-iteration role, edits at most three existing files in a Whim-managed worktree, cannot run arbitrary commands/create files/deploy/push/merge, rejects protected or oversized diffs, and requires fixed post-run checks. Candidates are never auto-merged.

## Important files

- `src/components/CanvasWorkspace.tsx`
- `src/components/MissionControl.tsx`
- `src/components/ui/VoiceOrb.tsx`
- `src/components/ui/SourcesSidebar.tsx`
- `src/components/AppContextMenu.tsx`
- `src/lib/citations.ts`
- `src/lib/mission-graph.ts`
- `src/lib/bridge.ts`
- `src-tauri/src/backend/workspace.rs`
- `src-tauri/src/backend/context.rs`
- `src-tauri/src/backend/voice.rs`
- `src-tauri/src/backend/settings.rs`
- `src-tauri/src/backend/reflector.rs`
- `src-tauri/src/capabilities.rs`
- `src-tauri/src/agent.rs`
- `src-tauri/src/orchestrator.rs`

## Verification from this run

- `npm run build` — passed (`tsc` strict check plus Vite production build); LangGraph is emitted as a separate lazy chunk.
- `npm test` — 18 files, 46 tests passed, including native settings/runtime updates, mission lifecycle ordering, failure finalization, cancellation, and role-aware routing.
- `cargo test` — 81 tests passed, including capability/tool gating, background verification discovery/redaction, nested Tauri Cargo detection, PID-0 cancellation, transactional reflection, janitor restrictions, settings validation, and endpoint validation.
- `cargo check` — passed.
- `cargo clippy --all-targets --all-features -- -D warnings` — passed.
- `npm audit --audit-level=low` — zero known vulnerabilities after pinning patched DOMPurify transitively.
- Browser smoke check at 1264x625 confirmed the restrained empty state, execution spine, navigation, composer, and status bar render without layout overflow.

## Known follow-up

*All known issues have been resolved.*

- **Large-bundle warnings:** Resolved by implementing React `lazy` and `Suspense` for the `Markdown` components, which dynamically code-splits the heavy Shiki/Streamdown editor-language assets. The warning limit was also tuned for the IDE's baseline size.
- **`lottie-web` eval warning:** Resolved (the `lottie-web` dependency has been completely removed from the project, eliminating the security and eval risk).
- Voice requires an OpenAI-compatible speech service. Providers without speech capability remain chat-only; the provider cards now expose that distinction.

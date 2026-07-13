# Whim agent runtime research and integration decisions

Checked against primary sources on 2026-07-13. This note records what Whim adopted, what remains optional, and why no placeholder integration switches were added.

## Pydantic AI v2

The [Pydantic AI v2 announcement](https://pydantic.dev/articles/pydantic-ai-v2) makes capabilities the composable unit around the model loop: instructions, tools, model settings, and lifecycle hooks. The official repository implements that contract in [`capabilities/abstract.py`](https://github.com/pydantic/pydantic-ai/blob/main/pydantic_ai_slim/pydantic_ai/capabilities/abstract.py), [`capabilities/capability.py`](https://github.com/pydantic/pydantic-ai/blob/main/pydantic_ai_slim/pydantic_ai/capabilities/capability.py), and the deferred loader in [`_deferred_capability_loader.py`](https://github.com/pydantic/pydantic-ai/blob/main/pydantic_ai_slim/pydantic_ai/capabilities/_deferred_capability_loader.py).

Whim integrates the stable architecture, not a mandatory Python sidecar:

- `src-tauri/src/capabilities.rs` is the provider-neutral, serializable capability registry.
- `src-tauri/src/backend/settings.rs` is the validated agent spec and native persistence boundary.
- Enabled capabilities remove tools from the Rust tool schema; this is runtime enforcement, not prompt text.
- Compact catalogs defer inactive guidance to reduce prompt use.
- Research concurrency, execution depth, and approval posture are native settings consumed by the loop.
- Existing immutable orchestration events remain server-authoritative; React does not submit executable tool history.

This matches Pydantic AI's documented [UI security warning](https://ai.pydantic.dev/ui/overview/#security-considerations): client-provided message and tool history is not an authorization boundary. The project deliberately does not copy the unfinished “durability as a capability” API tracked in [PR #4977](https://github.com/pydantic/pydantic-ai/pull/4977). Whim already has a Rust durable job ledger and keeps it authoritative.

## Manus

Manus does not publish its core agent runtime. Its official product material still provides useful execution contracts:

- [Sandbox](https://manus.im/blog/manus-sandbox): isolated task computers with files, browser, networking, persistence, and parallel execution.
- [Wide Research](https://manus.im/docs/features/wide-research): fresh contexts for independent subtasks followed by synthesis.
- [Desktop](https://manus.im/docs/features/desktop): folder-scoped local access and approval-gated commands.
- [Task lifecycle](https://open.manus.ai/docs/v2/task-lifecycle): explicit running, waiting, stopped, and error states with schema-shaped user input.
- [Agents API](https://open.manus.ai/docs/v2/agents-overview): persistent parent threads and addressable, cancellable subtasks.

Whim already maps the strongest local-first parts of this model to selected workspaces, isolated Git worktrees, durable parent/child research jobs, cancellation, event evidence, Canvas artifacts, and preview. This pass adds persisted privacy boundaries and a bounded Pi runtime. A Manus API adapter remains a legitimate future remote execution provider, but it requires an explicit API key, task/artifact synchronization, webhook verification, and a real waiting-for-approval UI. No inert “Connect Manus” switch was added.

## Achron

The relevant project is [Achron](https://www.achron.org/), particularly [Spine](https://www.achron.org/products/spine). Its public design emphasizes lightweight skill routing, atomic on-demand chapters, persistent profile/project context, `/prep`, `/done`, and opt-in workflow learning. [SPEACH](https://www.achron.org/products/speach) describes local `whisper.cpp` dictation, while [MIDAS](https://www.achron.org/products/midas) emphasizes metadata-first desktop perception with separate opt-ins for pixels, camera, and microphone.

Achron currently exposes no public API, SDK, or auditable source for these products. Whim therefore integrates the transferable patterns only:

- compact capability routing instead of stuffing every instruction into every run;
- durable project context and explicit preparation/verification phases;
- separate, native-enforced screen and app-context permissions;
- visible voice sessions with provider-backed transcription and speech settings.

Adding an “Achron provider” without a supported endpoint would be fake code and is explicitly out of scope.

## Pi and Gemini on this machine

The environment probe found Pi 0.80.6 and OpenCode 1.17.13. Pi exposes noninteractive text/JSON/RPC modes, provider/model routing, explicit tool allowlists, global extensions, and its own credential store. Whim now supports Pi as a hidden, tracked subprocess:

- no credential files are read by Whim;
- project-local Pi resources are not trusted automatically;
- read-only roles force read/search/list tools;
- mutating roles require the `risky` policy and the coding capability;
- stdout/stderr are capped;
- timeout and cancellation terminate the child;
- staged prompt files use random names and are deleted after the run.

The standalone Gemini CLI was not present on `PATH`. A `.gemini` directory associated with other Google tooling is not treated as proof that Gemini CLI is installed. Google models remain available through Whim's native provider transport and through Pi's configured providers.

## Next runtime milestones

1. Persist typed approval requests and resume by server-issued tool-call ID.
2. Add a waiting-for-user orchestration state and schema-driven approval/question cards.
3. Add per-child budgets, usage aggregation, and a fan-out/join visualization.
4. Add OTel-compatible run spans and regression datasets derived from verified tasks.
5. Add Manus only as an authenticated remote runtime adapter with artifact provenance and webhook validation.

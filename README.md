# Whim

**Build at the speed of intent — agent-first.**

Whim is a Windows-first desktop prototype for a provider-neutral vibe-coding environment, reshaped around the agent. Describe what you want, steer it naturally, and keep the path to deployment in the same workspace. The agent chat (Mission Control) is the primary surface; the project file tree and a read-only file viewer are satellites around it — there is no editor and no simulated live preview.

## Prototype status

This repository is a working **product prototype**, not yet a production-ready IDE.

The application is a Tauri 2 Windows desktop app with a Rust backend and a React 19, TypeScript, Vite, Tailwind, and WebView2 interface. The agent chat drives the experience; the editor and simulated live preview were removed during the agent-first redesign so the layout reads like Codex Desktop / Claude Code Desktop. The main product surfaces are implemented and navigable:

| Surface | Implemented state |
| --- | --- |
| Build | Agent-first workspace: read-only project file tree, Mission Control agent chat as the central surface, and a read-only file viewer when you open a file |
| Agent | Mission Control chat and model selection; browser preview uses a deterministic demo response, while the native app can invoke the Whim native agent |
| Providers | Provider hub, Windows toolchain discovery, credential-name discovery, in-app API-key entry, and provider model discovery |
| Ecosystem | Searchable MCP, skill, and IDE catalog with permission cards and workspace-local UI state |
| Ship Hub | Adapter catalog, project-aware native preflight for supported CLIs, readiness stream, and explicit human-owned production guard |
| Autopilot | Persisted automation preferences, environment discovery, safety-rule locks, and reviewable personalization surfaces |
| Commands | Searchable command palette with keyboard navigation into the core product hubs |

The Rust bridge also implements guarded workspace file access, PowerShell command execution, environment discovery, native agent prompts/models/sessions, deploy preflight, and confirmed CLI deployment commands.

## Current limitations

- No AI provider credentials or local model were configured during verification. Real agent runs require connecting a supported provider or a local model such as Ollama or LM Studio.
- The agent chat uses a deterministic demo response in browser preview mode and deliberately simulates native-only operations; it is useful for interface evaluation, not proof of a real AI or deployment run. The native app can invoke the real Whim native agent.
- The editor and simulated live preview were removed during the agent-first redesign. File browsing is read-only; there is no in-app code editing.
- The Ecosystem catalog and several automation behaviors are product-complete interface/spec surfaces, but a general plugin sandbox and background automation engine are not implemented end to end.
- Native deploy preflight and command adapters exist for Vercel, Netlify, Cloudflare, Render, Railway, Fly.io, and Docker. Azure, Windows packaging, and several broader deployment targets remain UI/spec-only.
- No production deployment was executed. Production promotion, billing, secrets, and destructive operations remain intentionally human-owned.
- A Windows x64 setup executable and standalone application were built and smoke-tested. The optional MSI bundler did not finish in this run, so MSI is not included.
- The `tauri::test` harness (`mock_builder`/`get_ipc_response`) cannot load in this sandbox because `WebView2Loader.dll` is absent (the `winget install Microsoft.EdgeWebView2Runtime` step reports success but deploys no loader here). The agent-dispatch-vs-real-provider E2E therefore runs on a WebView2-capable machine; in this environment the orchestration lifecycle is covered by a runtime-free integration test over the real `DurableJobStore` + `BackendState`.

## Run the prototype

### Prerequisites

- Windows 10 or 11.
- A current Node.js LTS release and npm.
- For the desktop app: Rust with the stable MSVC toolchain, Microsoft C++ Build Tools with **Desktop development with C++**, and Microsoft Edge WebView2.

See the official [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) for installation details.

### Install

```powershell
npm install
```

### Browser development

```powershell
npm run dev
```

Vite serves the interface at [http://localhost:1420](http://localhost:1420).

### Windows desktop development

```powershell
npm run tauri dev
```

This starts the Vite development server and opens the native Tauri window.

## Build

Build the frontend:

```powershell
npm run build
```

Build the Windows application and configured installers:

```powershell
npm run tauri build
```

Tauri writes release artifacts under `src-tauri/target/release/bundle/`. See the official [Windows installer guide](https://v2.tauri.app/distribute/windows-installer/) for MSI, NSIS, WebView2, and signing details.

## Verified through 12 July 2026
 
- `npm run build` — passed.
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml` — passed.
- `cargo check --manifest-path src-tauri/Cargo.toml` — passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` — passed, 63 tests (including the env-gated orchestration lifecycle integration test in `backend/orchestration.rs`, which is skipped by default and runs with `WHIM_E2E_PROVIDER` set).
- `npm test -- --run` — passed, 11 files and 31 tests.
- `npm run tauri -- build --debug --no-bundle` — passed; built the current native executable at `src-tauri/target/debug/workwhim-ide.exe`.
- Durable, neutral verification recording of lint/test/build results in the task ledger (`jobs.json`) verified under native runs.
- Enhanced layout readability and scaling tested and verified for 1920x1080 resolution screens.
- Browser verification covered Build/agent-first, agent send, Provider Hub, Ecosystem, Ship Hub, Autopilot, and the command palette.
- The release executable launched as **Whim IDE**, exposed the expected Windows accessibility controls, and closed cleanly.
- The NSIS x64 setup executable was generated successfully.

## Documentation

- [Product thesis, values, features, and metrics](./docs/product.md)
- [Architecture](./docs/architecture.md)
- [Provider, plugin, and deployment ecosystem](./docs/ecosystem.md)
- [Trust and automation tiers](./docs/trust-and-automation.md)
- [Research and official sources](./docs/research.md)
- [Transformation roadmap and current delivery boundaries](./docs/roadmap.md)
- [Portable, restrictive project harness profiles](./docs/harness-profile.md)

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | React interface and interaction components |
| `src-tauri/` | Rust host, Tauri capabilities, packaging, and native configuration |
| `docs/` | Product and technical documentation |

## Product principle

Whim should automate everything that interrupts creative flow, while keeping every consequential action visible, attributable, portable, and reversible.

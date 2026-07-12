# Product

> **Whim IDE — Build at the speed of intent.**

## Thesis

The best environment for vibe coding is not a code editor with a chat panel. It is an intent-to-outcome workspace.

A user should be able to describe, show, or manipulate the result they want; watch it become real; steer it in ordinary language; and ship it without first learning how to assemble models, runtimes, plugins, infrastructure, testing, secrets, and deployment pipelines.

Whim preserves the playful flow that makes vibe coding compelling, then introduces engineering discipline automatically as the work approaches production.

## Core values

### Intent first

Text, voice, screenshots, URLs, sketches, existing repositories, and direct interaction with a preview are all valid inputs. The product optimizes for the desired behavior and experience, not the syntax used to request it.

### Immediate feedback

Every meaningful change should produce the fastest useful feedback: a runnable preview, a behavioral summary, a test result, or a visible artifact. A diff alone is not an outcome.

### Creative flow

Keep latency, setup, modal dialogs, and context switching low. Let the user explore freely, compare variants, interrupt an agent, and change direction without fear.

### Progressive control

New builders may stay entirely in conversation and preview. Experienced builders can inspect code, terminals, context, costs, permissions, models, and infrastructure, then override any automatic choice.

### Automatic, but reversible

Whim may configure the environment, select models, install integrations, create tests, and prepare deployments automatically. Every change must be visible, attributable, exportable, and undoable.

### Ownership

The user owns the files, Git history, configuration, deployment manifests, and project knowledge. Local models, bring-your-own keys, custom endpoints, and self-hosting are first-class paths.

### Safe delegation

Agents receive the smallest permissions, credentials, context, and budget needed for a task. The agent that creates a production change cannot approve and promote that same change by itself.

### Outcome metrics

Success is a working user journey that remains healthy after release. Generated lines, tool calls, and token volume are operational details, not product value.

## The Whim loop

1. **Express** — describe the outcome with words, voice, images, a URL, or an existing project.
2. **Manifest** — Whim creates the smallest runnable slice and explains what became real.
3. **Observe** — preview the product and inspect behavior, logs, data, and agent activity.
4. **Steer** — point, speak, edit, compare, undo, or refine without restating the whole project.
5. **Verify** — Whim selects the lightest useful checks during exploration and raises the bar before release.
6. **Ship** — deploy a preview, validate it in its real environment, then promote with an accountable approval.
7. **Learn** — feed runtime evidence and user corrections back into reviewed project knowledge.

## Experience modes

The modes are one continuous workflow, not separate products.

| Mode | User intent | Default behavior |
| --- | --- | --- |
| **Vibe** | Explore, prototype, and find the shape of an idea | Fast previews, low ceremony, aggressive checkpoints, sandbox-only automation |
| **Build** | Turn the promising direction into maintainable software | Living acceptance criteria, deeper context, durable tests, structured multi-agent work |
| **Ship** | Release and operate the product | Independent verification, security and policy gates, preview environment, human promotion, rollback |

## Implemented prototype snapshot

| Area | Implemented now | Boundary |
| --- | --- | --- |
| Workbench | Project sidebar, live product preview, Changes view, terminal drawer, build checks, and save flow | Browser preview simulates native filesystem and command operations |
| Code | Monaco editor, language selection, custom theme, editable buffer, and Ctrl+S | Full language-server, debugger, and repository-wide symbol services are future work |
| Agent | Mission Control conversation, Vibe/Build/Ship selector, model picker, native agent bridge, and session reuse | A connected provider or local model is required for a real native agent run |
| Providers | Curated/direct/gateway/local/enterprise lanes, toolchain discovery, credential-name discovery, in-app key entry, and model listing bridge | No provider credentials were configured in the verified snapshot |
| Ecosystem | Search, filters, permission cards, and workspace-local install toggles for MCP, skills, and IDE items | General package installation, signing verification, and plugin sandbox execution remain spec-only |
| Ship | Adapter selection, native project/CLI preflight for seven targets, readiness stream, and production guard | No production deployment was executed; Azure and Windows adapter cards are UI/spec-only |
| Autopilot | Persisted automation switches, locked safety rules, environment discovery, and reviewable learned-rule surfaces | Most background automation workers and undo history are represented, not running services |
| Commands | Ctrl+K command palette and navigation across core hubs | Some action labels navigate to a surface rather than executing the final operation |
| Native backend | Guarded workspace reads/writes, environment and credential discovery, PowerShell commands, native agent prompts/models/sessions, deployment preflight and confirmed CLI execution | The prototype is not yet a hardened multi-tenant sandbox |

## Target feature inventory

The inventory below remains the intended complete product surface.

| Area | Target capability |
| --- | --- |
| Intent | Text and voice prompting, screenshot and URL input, repository import, direct preview selection, visual variants |
| Workspace | Code editor, terminal, Git, diffs, live preview, browser and device views, data and logs |
| Agents | Lead agent, specialist subagents, isolated worktrees, task graph, background execution, pause and steer |
| Context | Code index, architecture map, user journeys, decisions, glossary, design tokens, reviewed memories |
| Customization | Automatic environment discovery, rules, formatting, shortcuts, themes, models, skills, and plugin recommendations |
| Models | Curated defaults, BYOK, subscriptions, gateways, enterprise endpoints, and local models with task-aware routing |
| Plugins | Editor extensions, MCP servers, portable skills, agent tools, hooks, and deployment adapters |
| Verification | Build, lint, types, tests, real-browser flows, accessibility, performance, visual, security, and dependency checks |
| Deployment | Provider-neutral preview and production deployments, domains, secrets, data services, health checks, and rollback |
| Trust | Scoped permissions, context redaction, sandboxing, checkpoints, provenance, budgets, and accountable approvals |
| Windows | Native desktop distribution, WebView2, PowerShell, Command Prompt, Git Bash, WSL, notifications, and Credential Manager |
| Operations | Runtime logs, analytics, errors, user feedback, incident reproduction, repair drafts, and deployment history |

## Product measures

- Median time from first intent to a working preview.
- Percentage of projects deployed without manual configuration.
- First-pass success rate for declared user journeys.
- Rework time per accepted agent change.
- Critical regressions and security issues caught before release.
- Median recovery time after a bad change or deployment.
- Provider cost per accepted outcome.
- Plugin connection time and percentage installed without excessive permissions.
- Percentage of users who move from Vibe to Ship without leaving Whim.

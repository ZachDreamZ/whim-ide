# Provider, plugin, and deployment ecosystem

Whim should feel configured before the user knows what needs configuring. Underneath that simplicity, every integration must remain portable, inspectable, and replaceable.

## Provider strategy

### Implemented provider surface

Provider Hub implements curated, direct, gateway, local, enterprise, and custom lanes; Windows environment and credential-name discovery; model selection; and native agent prompt execution. Browser mode uses explicit demo data. The verified native environment had no configured provider credential, so a real AI response was not exercised.

### One workflow, many model sources

The session, tool protocol, project memory, and verification record belong to Whim and the project—not to a model provider. Users can change models in the middle of a task without rebuilding the workflow.

Supported provider classes:

- curated Whim models with tested provider/model combinations;
- direct API keys and enterprise endpoints;
- existing provider subscriptions where their terms permit it;
- gateways and OpenAI-compatible endpoints;
- local models through runtimes such as Ollama and LM Studio.

### Automatic routing

The router considers capability, historical task success, latency, context size, privacy, tool support, availability, and the user's cost ceiling. It may use a fast model for repository search, a deeper model for architecture, a vision model for visual review, and an independent model for verification.

Automatic routing must always expose:

- which model and provider were selected;
- why they fit the task;
- the estimated and actual cost;
- whether data leaves the device or organization;
- any fallback that occurred.

Whim's native agent supports OpenAI, Anthropic, Google, DeepSeek, Qwen, Xiaomi, any OpenAI-compatible endpoint, and local runtimes (Ollama, LM Studio). The provider-neutral architecture means the session, tool protocol, project memory, and verification record belong to Whim and the project — not to a model provider.

## Plugin strategy

### Implemented ecosystem surface

The prototype includes catalog search, type filters, permission chips, trust language, and workspace-local add/remove state for MCP, skills, and IDE items. These interactions validate the product flow; they do not yet download, authenticate, verify signatures for, or execute arbitrary third-party plugins.

### Four extension lanes

| Lane | Purpose | Examples |
| --- | --- | --- |
| Editor extensions | Language support and editor behavior | LSP, formatter, debugger, themes, keymaps |
| MCP servers | External tools and data | GitHub, Figma, databases, browsers, observability |
| Skills and rules | Reusable project or team procedures | Deployment playbook, design system, review checklist |
| Agent plugins and tools | Executable behavior and lifecycle hooks | Custom tools, policy hooks, context compaction, adapters |

Whim should support portable formats first: MCP, `SKILL.md`, `AGENTS.md`, and an editor-extension compatibility layer.

### One-click installation without blind trust

Every install shows a concise capability card:

- publisher and signature;
- requested files, commands, network destinations, secrets, and UI surfaces;
- whether code executes locally or remotely;
- context and token impact;
- version pin and update policy;
- uninstall and rollback behavior.

Tools are disabled until needed, credentials are granted as scoped handles rather than raw values, and permission expansion requires a new approval. Whim can generate a plugin from a request, but locally generated plugins receive the same sandboxing and review as marketplace code.

### Automated integration

When the user asks to add a service, Whim should:

1. find a verified native, MCP, or API integration;
2. explain the capabilities it needs;
3. authenticate through the provider's supported flow;
4. configure the project and development environment;
5. create a minimal verification;
6. record the decision in project knowledge;
7. keep the integration replaceable.

Reference contracts for the ecosystem model are available from the broader MCP and agent-tooling community.

## Deployment strategy

### Implemented Ship surface

The Rust backend implements project-aware preflight and confirmed command construction/execution for Vercel, Netlify, Cloudflare, Render, Railway, Fly.io, and Docker. Ship Hub exposes adapter selection, readiness logs, preview-oriented flow, and a locked human production stage.

No production deployment was executed during verification. The Azure and Windows cards, portable manifest language, managed service provisioning, rollback history, and several broad target families remain interface/spec-only.

### A portable deployment manifest

Whim should compile detected project intent into one internal manifest describing:

- build and start commands;
- processes and scheduled work;
- ports, routes, domains, and health checks;
- databases, queues, object storage, and caches;
- public configuration and secret references;
- CPU, memory, region, scaling, and persistence needs;
- preview, staging, and production policy;
- migrations, smoke tests, rollback, and teardown.

Provider adapters translate that manifest to native configuration. Generated configuration remains in the repository whenever the target supports infrastructure as code.

### Target classes

| Target | Initial adapter families |
| --- | --- |
| Web and serverless | Vercel, Netlify, Cloudflare, Azure Static Web Apps |
| Managed applications | Render, Railway, Azure App Service, Google Cloud Run |
| Containers | Docker, Compose, Azure Container Apps, AWS ECS, Kubernetes |
| Windows applications | Tauri MSI/NSIS, MSIX, Microsoft Store |
| Self-hosted | SSH host, VM, bare Docker, private Kubernetes |
| Data and AI | Managed Postgres and object stores, Hugging Face Spaces, compatible GPU hosts |
| Mobile build | Android and iOS build-service adapters where platform signing permits |

The table is the target inventory. The seven adapters listed above have native backend support; the rest remain planned or interface/spec-only.

### Ship sequence

1. Detect the application and propose a target with a portable alternative.
2. Show resources, permissions, recurring cost, and data location.
3. Create or select accounts, repository, secrets, services, and domain.
4. Deploy an isolated preview.
5. Run build, migration, smoke, browser, security, accessibility, and health checks appropriate to the risk.
6. Let the user inspect the real URL and evidence.
7. Promote with an accountable approval.
8. Monitor health and preserve an immediate rollback path.

Production is never simply another agent tool call. The generating agent cannot approve its own release.

## Portability rules

- Git is the source of truth for project artifacts.
- Provider-specific output must be generated from portable intent where possible.
- Secrets are referenced, never embedded.
- A user can export providers, rules, skills, tool configuration, and sanitized history.
- Disabling Whim must not make the application undeployable or unmaintainable.

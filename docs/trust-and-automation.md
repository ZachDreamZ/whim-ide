# Trust and automation

Whim should automate aggressively inside a clearly bounded environment and become deliberately conservative as impact increases. Autonomy is a capability contract, not a personality setting.

## Implemented safeguards

- Workspace file operations resolve beneath a selected root and reject traversal and absolute-path escape attempts.
- Provider, agent, model, and deployment identifiers receive strict validation before process construction.
- Deploy modes are explicit per adapter, and backend deployment execution requires a confirmation flag.
- Auto-approve is off in the application bridge; the backend rejects unconfirmed auto-approval requests.
- Credential discovery reports provider and variable names/sources rather than returning secret values to the interface.
- Production, billing, secret, security-sensitive, and destructive Autopilot actions are represented as locked or always-ask rules.
- Ship Hub separates preview readiness from human-owned production promotion.

The Rust test suite currently verifies strict identifiers, explicit deployment modes, and rejection of path traversal/absolute paths. All 3 tests pass.

## Safeguards still to implement

- A general plugin signature, installation, and process sandbox.
- Isolated worktrees or disposable execution environments for every autonomous task.
- Complete prompt-context redaction and indirect prompt-injection screening.
- Durable provenance, approval, cost, and recovery records.
- Independent production reviewer identities and enforced separation of duties across external systems.
- Comprehensive SAST, DAST, dependency, license, infrastructure, migration, and adversarial test gates.

The remaining sections define the complete product contract; they should not be read as claims that every control is already enforced.

## Automation tiers

| Tier | Name | Whim may do automatically | Required boundary |
| --- | --- | --- | --- |
| 0 | Observe | Read approved files, index the project, explain, search approved sources | No writes or external mutations |
| 1 | Assist | Propose and apply scoped edits, create local checkpoints, run safe read-only tools | Reviewable diff and instant undo |
| 2 | Flow | Iterate on code, builds, tests, and browser checks inside a sandbox and budget | Isolated worktree, scoped network/process access, no production credentials |
| 3 | Ship | Provision a preview, use scoped secret handles, run migrations in non-production | Readiness gates and explicit production promotion |
| 4 | Managed autonomy | Run policy-approved background jobs across repositories and environments | Separate identities, independent review, organization policy, full audit |

The user can lower a tier at any time. Raising a tier requires a clear explanation of the additional consequences and permissions.

## Automatic customization

Customization follows a reversible learning loop:

1. **Discover** installed runtimes, shells, Git settings, WSL environments, local models, editor preferences, and project conventions.
2. **Recommend** the smallest useful set of models, rules, formatters, tests, skills, and plugins.
3. **Apply** changes transactionally with a before/after summary and checkpoint.
4. **Learn** from repeated corrections, successful workflows, and rejected suggestions.
5. **Promote** a learned preference to a durable rule only with review or a previously approved policy.
6. **Expire** duplicated, conflicting, or stale inferred memories.

Whim may infer that a user prefers pnpm; it should not silently rewrite every project to pnpm. Personal convenience never overrides repository or organization policy.

## Permission model

Permissions are based on capabilities and scope:

- filesystem paths and operation type;
- command patterns and process elevation;
- network destinations and methods;
- provider and plugin tools;
- secret handles and allowed consumers;
- source-control operations;
- cloud resources and deployment environments;
- time, token, money, and retry budgets.

Decisions are allow once, allow for this task, allow for this project, policy allow, or deny. Broad wildcard access is visible and discouraged. A plugin or subagent cannot inherit more authority than its parent task.

## Secure execution requirements

### Treat context as untrusted

Repository text, web pages, issue and pull-request content, documentation, MCP responses, logs, and other agents may contain instructions intended to manipulate the agent. Whim keeps a strict instruction hierarchy, labels external content as data, screens likely prompt injection, and never executes free-form tool output directly.

### Protect secrets before prompting

- Exclude secrets, private keys, credential files, and user-selected paths from indexing by default.
- Scan and redact context before it leaves the device.
- Use Windows Credential Manager or an approved organization vault.
- Give tools short-lived, scoped handles instead of displaying raw values.
- Show whether a provider receives source, logs, attachments, or project memory.

### Isolate execution

- Use a fresh worktree or equivalent snapshot for autonomous changes.
- Run untrusted builds and plugins in a sandbox with default-deny network access.
- Keep production credentials out of development and agent environments.
- Require explicit elevation; do not run the desktop application as administrator by default.
- Stop processes and revoke temporary credentials when a task ends.

### Defend the supply chain

Flag new or changed dependencies, package scripts, CI workflows, Dockerfiles, infrastructure manifests, and downloaded executables. Check package existence, source, age, signature, known vulnerabilities, license, and lockfile changes. Pin automation dependencies and third-party CI actions to immutable versions where supported.

### Preserve test integrity

An agent cannot prove itself correct by deleting tests, weakening assertions, replacing real dependencies with mocks, or writing only tests that assert its generated behavior. Whim highlights those changes and uses independent or human-authored checks for authentication, authorization, cryptography, payments, and other critical paths.

### Separate creation from approval

The identity that generated an artifact cannot approve, sign, merge, or promote it to production. High-impact changes require an independent verifier and a named human owner. Organization policy may require a second human for security-critical code or infrastructure.

## Verification ladder

### During Vibe

- compile or render the affected surface;
- observe console and network errors;
- run focused tests;
- capture a checkpoint;
- use a real preview for user-visible behavior when useful.

### During Build

- full type and lint checks;
- relevant unit, integration, and browser journeys;
- accessibility and responsive checks;
- dependency, secret, and static security scans;
- migration and rollback rehearsal where data changes.

### Before Ship

- reproducible clean build;
- independent review of the behavioral change and high-risk files;
- real preview deployment;
- smoke, health, browser, security, and policy checks;
- provenance record and named owner;
- explicit production approval and tested rollback.

Passing generated tests is evidence, not proof. Whim displays what was and was not verified.

## Provenance and recovery

Every accepted change can be traced through:

request → model and provider → retrieved context → tool calls → file changes → tests → human decisions → commit → build → deployment.

Checkpoints are automatic before broad edits, dependency changes, migrations, plugin installation, and deployment. Recovery actions are first-class: restore files, revert a commit, roll back a deployment, restore a database snapshot, revoke credentials, or disable a plugin.

## Privacy and telemetry

Outcome measurement is local by default. Product analytics require informed opt-in and must avoid source code, prompts, secrets, or file contents unless the user explicitly submits diagnostic material. Organization deployments can define retention, residency, approved providers, and redaction policy.

## Security sources

OWASP explicitly calls out inappropriate trust in AI-generated code and recommends human review, static analysis, guardrails, and policy enforcement: [OWASP Top 10:2025 next steps](https://owasp.org/Top10/2025/X01_2025-Next_Steps/).

The current [OWASP Secure Coding with AI Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Coding_with_AI_Cheat_Sheet.html) covers context leakage, prompt injection, MCP and plugin risk, test manipulation, supply-chain changes, multi-agent boundaries, audit trails, and human accountability.

The [OWASP AISVS code-generation appendix](https://github.com/OWASP/AISVS/blob/main/1.0/en/0x92-Appendix-C_AI_for_Code_Generation.md) provides verification requirements for context redaction, code scanning, provenance, infrastructure changes, and separation of duties.

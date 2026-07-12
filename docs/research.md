# Research basis

This is the concise evidence base behind Whim's product requirements. Primary research and official product documentation are preferred over comparative marketing claims.

## What vibe coding optimizes

Andrej Karpathy's original description emphasized giving in to the flow and interacting with working results instead of thinking about code line by line:

- [Original vibe coding post, 2 February 2025](https://x.com/karpathy/status/1886192184808149383)

A systematic qualitative study revised in June 2026 characterizes vibe coding as conversational co-creation centered on experimentation, developer flow, joy, and trust. It also identifies recurring breakdowns in specification, reliability, debugging, latency, review burden, and collaboration:

- [Good Vibrations? A Qualitative Study of Co-Creation, Communication, Flow, and Trust in Vibe Coding](https://arxiv.org/abs/2509.12491)
- [Microsoft Research publication page](https://www.microsoft.com/en-us/research/publication/good-vibrations-a-qualitative-study-of-co-creation-communication-flow-and-trust-in-vibe-coding/)

Product implication: preserve conversation, experimentation, and immediate results while automating specification, verification, recovery, and collaboration around them.

## Productivity should be measured, not assumed

METR's early-2025 randomized trial found that experienced open-source developers working on familiar repositories took 19% longer with the AI tools available at the time, despite believing they were faster. METR's February 2026 follow-up says newer tools likely provide more benefit, but selection effects make the magnitude uncertain:

- [Early-2025 developer productivity study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
- [2026 experiment update](https://metr.org/blog/2026-02-24-uplift-update/)

Product implication: optimize and instrument time to a correct, accepted outcome, including rework and maintenance—not perceived speed, generated lines, or benchmark scores alone.

## Provider-neutral reference: OpenCode and Zen

OpenCode is an open-source agent available through terminal, desktop, and IDE clients. Its public architecture and formats make it the strongest reference for Whim's neutral kernel:

- [OpenCode repository and MIT license](https://github.com/anomalyco/opencode)
- [Headless OpenAPI server](https://dev.opencode.ai/docs/server/)
- [SDK](https://opencode.ai/docs/sdk/)
- [Provider support, custom endpoints, and local models](https://opencode.ai/docs/providers)
- [Optional curated Zen gateway](https://opencode.ai/docs/zen)
- [Agents and permissions](https://opencode.ai/docs/agents/)
- [MCP servers and OAuth](https://opencode.ai/docs/mcp-servers/)
- [Plugins](https://dev.opencode.ai/docs/plugins/)
- [Custom tools](https://opencode.ai/docs/custom-tools/)
- [Portable skills](https://dev.opencode.ai/docs/skills)
- [Current Windows and WSL guidance](https://opencode.ai/docs/windows-wsl/)

Product implication: integrate through the server/API boundary, keep a curated default optional, and improve the Windows-native, credential, installation, plugin-safety, and deployment experience around it.

## Competitive feature references

### Cursor

- [Agent tools and guardrails](https://docs.cursor.com/en/agent/tools)
- [Background agents](https://docs.cursor.com/background-agent)
- [Automatic checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints)
- [Curated MCP directory](https://docs.cursor.com/en/tools/mcp)
- [Web and mobile handoff](https://docs.cursor.com/en/background-agent/web-and-mobile)

### Windsurf

- [Cascade memories, rules, workflows, and skills](https://docs.windsurf.com/windsurf/cascade/memories)
- [App Deploys](https://docs.windsurf.com/windsurf/cascade/app-deploys)

### Lovable

- [Real-browser verification](https://docs.lovable.dev/features/browser-testing)
- [Testing and verification](https://docs.lovable.dev/features/testing)
- [Workspace and project knowledge](https://docs.lovable.dev/features/knowledge)
- [Security scanning](https://docs.lovable.dev/features/security)
- [GitHub sync and portability](https://docs.lovable.dev/integrations/github)

### Replit

- [Project Editor and direct deployment](https://docs.replit.com/learn/projects-and-artifacts/project-editor)
- [MCP connections](https://docs.replit.com/build/connect-via-mcp)
- [Agent automation examples](https://docs.replit.com/references/agent/automation-examples)

### GitHub Copilot

- [Customization formats: instructions, agents, skills, hooks, and MCP](https://docs.github.com/en/copilot/reference/customization-cheat-sheet)
- [Agent hooks](https://docs.github.com/en/copilot/concepts/agents/hooks)

Product implication: the market has established agent execution, checkpoints, browser testing, memory, plugins, and one-click deployment as baseline features. The unfilled opportunity is combining them in one portable, Windows-native, provider-neutral lifecycle.

## Security and accountable automation

- [OWASP Top 10:2025 — inappropriate trust in AI-generated code](https://owasp.org/Top10/2025/X01_2025-Next_Steps/)
- [OWASP Secure Coding with AI Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Coding_with_AI_Cheat_Sheet.html)
- [OWASP AISVS appendix for AI code generation](https://github.com/OWASP/AISVS/blob/main/1.0/en/0x92-Appendix-C_AI_for_Code_Generation.md)

Product implication: context, tools, plugins, agents, CI, and deployment are part of the security boundary. Human ownership, least privilege, isolation, independent verification, provenance, and recovery must be product features rather than documentation-only advice.

## Windows and distribution

- [Tauri 2 prerequisites for Windows](https://v2.tauri.app/start/prerequisites/)
- [Tauri Windows installer documentation](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri distribution overview](https://v2.tauri.app/distribute/)
- [Windows Credential Locker](https://learn.microsoft.com/en-us/windows/apps/develop/security/credential-locker)
- [Windows Package Manager and repeatable configuration](https://learn.microsoft.com/en-us/windows/package-manager/)
- [Windows App SDK capabilities](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/)

Product implication: Whim should install and behave like a real Windows application, use supported secret storage and notifications, understand PowerShell and WSL, and automate machine and project setup through standard Windows facilities.

## Deployment references

- [Vercel preview and Git-based deployments](https://vercel.com/docs/deployments/git)
- [Vercel deployment management and rollback](https://vercel.com/docs/deployments/managing-deployments)
- [Windsurf App Deploys](https://docs.windsurf.com/windsurf/cascade/app-deploys)
- [Replit deployments and automations](https://docs.replit.com/references/agent/automation-examples)
- [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/)

Product implication: one-click release is only complete when preview, secrets, data, verification, production promotion, health, provenance, and rollback live in the same workflow.

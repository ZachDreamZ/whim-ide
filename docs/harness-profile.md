# Harness profiles

Whim supports an optional, portable project profile at `whim.harness.json` in the repository root. It is ordinary JSON: users can review, commit, copy, edit, or remove it without depending on Whim.

The native runtime treats a profile as a **restriction layer only**. It can remove tools, narrow Whim's direct `write_file` and `edit_file` paths, and lower run budgets. It cannot add tools, expand a workspace, enable a production deployment, bypass destructive-command protections, or override the user request and native guardrails.

## Example

```json
{
  "version": 1,
  "name": "Component review",
  "instructions": "Keep changes focused and preserve existing accessibility behavior.",
  "allowedTools": [
    "read_file",
    "write_file",
    "edit_file",
    "list_directory",
    "grep_files",
    "verify",
    "plan"
  ],
  "allowedWritePaths": ["src/components", "docs"],
  "verificationCommands": ["npm test", "npm run build"],
  "maxToolIterations": 8,
  "maxDurationMs": 300000
}
```

An active profile is announced in the native agent event stream and included in the agent's system context. A malformed profile fails the run before a provider request, rather than being ignored.

## Fields

| Field | Meaning | Limit |
| --- | --- | --- |
| `version` | Schema version. Current value is `1`. | Required/defaulted to `1` |
| `name` | Human-readable label shown in the agent event stream. | 96 characters |
| `instructions` | Project-specific descriptive guidance. It remains lower priority than Whim's native safety rules. | 12,000 characters |
| `allowedTools` | Allow-list of built-in agent tools. Omit to keep the normal native tool set. | 16 entries |
| `allowedWritePaths` | Workspace-relative prefixes allowed for `write_file` and `edit_file`. | 64 entries |
| `verificationCommands` | Suggested checks shown to the agent; these are never auto-run only because they are listed here. | 16 entries |
| `maxToolIterations` | Lower cap on the native agent loop. | 1–18 |
| `maxDurationMs` | Lower cap on a task's time budget. | 15,000–1,800,000 ms |

Supported `allowedTools` values are `read_file`, `write_file`, `edit_file`, `list_directory`, `grep_files`, `run_command`, `verify`, `plan`, `research`, `checkpoint`, `rollback`, `preview`, and `tunnel`.

## Important boundary

`allowedWritePaths` applies to Whim's direct file tools. A shell command is not path-sandboxed by that field; to remove shell access, omit both `run_command` and `verify` from `allowedTools`. Process, network, secret, container, WSL, and remote-runner confinement are separate execution-fabric work and are not represented as complete merely because a profile exists.

Never put API keys, passwords, or other credentials in this file. It is project configuration and may be committed or provided to the selected model as descriptive project context.

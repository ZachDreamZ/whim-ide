//! Native agent tool catalogue and display mapping.
//!
//! This leaf of the `agent` subsystem owns the `ToolDef` shape, the full and
//! read-only tool lists, the profile/mode-filtered selector, and the human label
//! map. It depends on `serde_json`, `crate::capabilities`, `crate::harness`,
//! and `crate::backend` but on no other `agent::*` module.

#![allow(dead_code)]

use serde_json::json;

use crate::agent::provider::AgentRole;
use crate::backend::settings::AppSettings;
use crate::backend::HarnessProfile;
use crate::capabilities::{capability_allows_tool, resolved_capabilities};

pub(crate) struct ToolDef {
    name: &'static str,
    description: &'static str,
    parameters: serde_json::Value,
}

/// Tool names that mutate the workspace or perform external side effects.
/// Withheld from the native agent when the Sensitive tool policy is "always".
const MUTATION_TOOLS: &[&str] = &[
    "write_file",
    "edit_file",
    "run_command",
    "checkpoint",
    "rollback",
    "preview",
    "tunnel",
];

/// Full tool set for the main agent (includes planning + research delegation).
pub(crate) fn tool_defs() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "read_file",
            description: "Read a UTF-8 text file from the workspace. Path is relative to the workspace root.",
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Relative file path" } },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "write_file",
            description: "Create or overwrite a workspace file with the given content.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative file path" },
                    "content": { "type": "string", "description": "Full file content" }
                },
                "required": ["path", "content"]
            }),
        },
        ToolDef {
            name: "edit_file",
            description: "Replace the first occurrence of old_text with new_text in a workspace file. Prefer targeted edits over full rewrites.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "old_text": { "type": "string" },
                    "new_text": { "type": "string" }
                },
                "required": ["path", "old_text", "new_text"]
            }),
        },
        ToolDef {
            name: "list_directory",
            description: "List immediate children of a workspace directory. Use '.' for the root.",
            parameters: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "description": "Relative directory path" } },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "grep_files",
            description: "Case-insensitive text search across workspace text files. Optional path scopes the search.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string", "description": "Optional relative scope" }
                },
                "required": ["pattern"]
            }),
        },
        ToolDef {
            name: "run_command",
            description: "Run a PowerShell command in the workspace. Prefer project scripts, tests, builds, and linters. Use for verification.",
            parameters: json!({
                "type": "object",
                "properties": { "command": { "type": "string" } },
                "required": ["command"]
            }),
        },
        ToolDef {
            name: "verify",
            description: "Run a build/test/lint command and report PASS/FAIL with a short tail of output. Call this after edits to confirm the change works before finishing. Never destructive.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Build/test/lint command" },
                    "timeout_ms": { "type": "number", "description": "Optional timeout in ms (default 30000)" }
                },
                "required": ["command"]
            }),
        },
        ToolDef {
            name: "delegate_task",
            description: "Delegate a task to a specialized sub-agent. This recursively triggers the selected agent role.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "role": { "type": "string", "enum": ["implementer", "tester", "researcher", "planner", "reviewer", "securityReviewer", "designer", "debugger", "releaseAgent"], "description": "The agent role to spawn" },
                    "task": { "type": "string", "description": "The specific instruction for the sub-agent" }
                },
                "required": ["role", "task"]
            }),
        },
        ToolDef {
            name: "plan",
            description: "Record an ordered checklist of concrete steps for the current task. Call this before non-trivial implementation so the user can follow progress. Re-call to revise the plan.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Ordered, concrete steps"
                    }
                },
                "required": ["steps"]
            }),
        },
        ToolDef {
            name: "research",
            description: "Spawn one or more parallel READ-ONLY research sub-agents. Give independent questions in `questions` for deep research; each can read/list/grep but never writes or runs commands.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "question": { "type": "string", "description": "One investigation (backward-compatible)" },
                    "questions": { "type": "array", "items": { "type": "string" }, "description": "Independent investigations to run concurrently (bounded by native Settings, max 8)" },
                    "path": { "type": "string", "description": "Optional relative scope" }
                }
            }),
        },
        ToolDef {
            name: "checkpoint",
            description: "Save a tracked-files-only checkpoint in an existing Git worktree BEFORE risky or large changes. It never initializes Git, changes the user's branch/config, or captures untracked files. No arguments.",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "rollback",
            description: "Restore tracked files from the last Whim checkpoint. Current tracked work is preserved in a local Git stash; untracked files remain untouched. Only use if the build or app breaks and you need to return to the last checkpoint. No arguments.",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "preview",
            description: "Start the project's local dev server to verify the app actually runs. Returns once the server is launching. No arguments.",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "tunnel",
            description: "Expose the local preview over a public tunnel. ONLY call this when the USER explicitly asks to share the app publicly; never use it unprompted. No arguments.",
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "browser_action",
            description: "Interact with a Playwright browser session.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["navigate", "back", "forward", "reload", "click", "type", "fill", "select", "check", "uncheck", "press", "captureScreenshot"] },
                    "args": { "type": "object" }
                },
                "required": ["action"]
            })
        },
        ToolDef {
            name: "computer_action",
            description: "Interact with Windows UI Automation.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["launch", "inspect", "invoke"] },
                    "args": { "type": "object" }
                },
                "required": ["action"]
            })
        },
    ]
}

/// Tool names that mutate the workspace or perform external side effects.
/// Withheld from the native agent when the Sensitive tool policy is "always".
pub(crate) fn tool_defs_for_profile(
    profile: &HarnessProfile,
    mode: AgentRole,
    settings: &AppSettings,
) -> Vec<ToolDef> {
    let capabilities = resolved_capabilities(settings, mode.as_str());
    let approval_blocks_mutation = settings.agent.approval_policy == "always";
    tool_defs()
        .into_iter()
        .filter(|tool| {
            profile.permits_tool(tool.name)
                && mode.permits_tool(tool.name)
                && capability_allows_tool(&capabilities, tool.name)
                && !(approval_blocks_mutation && MUTATION_TOOLS.contains(&tool.name))
        })
        .collect()
}

pub(crate) fn read_only_tool_defs(profile: &HarnessProfile) -> Vec<ToolDef> {
    tool_defs()
        .into_iter()
        .filter(|tool| {
            matches!(tool.name, "read_file" | "list_directory" | "grep_files")
                && profile.permits_tool(tool.name)
        })
        .collect()
}

pub(crate) fn tool_display(name: &str) -> String {
    let display = match name {
        "read_file" => "Read",
        "write_file" => "Write",
        "edit_file" => "Edit",
        "list_directory" => "Glob",
        "grep_files" => "Grep",
        "run_command" => "Bash",
        "verify" => "Verify",
        "plan" => "Plan",
        "research" => "Research",
        "checkpoint" => "Checkpoint",
        "rollback" => "Rollback",
        "preview" => "Preview",
        "tunnel" => "Tunnel",
        "delegate_task" => "Delegate",
        "browser_action" => "Browser",
        "computer_action" => "Desktop",
        other => other,
    };
    display.to_string()
}

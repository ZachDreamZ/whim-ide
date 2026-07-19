//! Native agent event model and durable auditing.
//!
//! This leaf of the `agent` subsystem owns the `AgentEvent` enum and its
//! serializable parts, plus the helpers that (a) emit a bounded event to the
//! desktop UI, (b) record a secret-free audit label into the durable ledger,
//! and (c) surface lightweight live-only progress. It depends on `tauri`,
//! `serde_json`, and `crate::backend` but on no other `agent::*` module.

#![allow(dead_code)]

use serde_json::{json, Value};
use tauri::{Emitter, Manager, State, WebviewWindow};

use crate::backend::{record_orchestration_agent_evidence, BackendState};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Text {
        text: String,
    },
    Reasoning {
        part: ReasoningPart,
    },
    #[serde(rename = "tool_use")]
    ToolUse {
        part: ToolUsePart,
    },
    Error {
        error: AgentErrorDetail,
    },
    Progress {
        message: String,
    },
    /// A non-fatal signal surfaced to the parent/main agent. Unlike `Error`,
    /// a warning never marks the run failed and never stops execution; it is
    /// advisory evidence (for example, a detected non-progress loop or an
    /// advisory iteration budget). The parent decides whether to continue.
    #[serde(rename = "warning")]
    Warning {
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasoningPart {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUsePart {
    pub id: String,
    pub tool: String,
    pub state: ToolUseState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUseState {
    pub status: String,
    pub input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentErrorDetail {
    pub code: Option<String>,
    pub message: String,
}

/// Emit the same bounded event that will appear in the final run result. A
/// failed desktop event delivery never changes the agent outcome: the command
/// result remains the durable source of truth and the frontend can reconcile
/// from it after a reconnect.
pub(crate) fn record_agent_event<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    operation_id: &str,
    events: &mut Vec<Value>,
    event: AgentEvent,
) {
    let event_val = serde_json::to_value(&event).unwrap();
    if let Some(label) = durable_audit_label(&event_val) {
        let backend = window.app_handle().state::<BackendState>();
        record_orchestration_agent_evidence(&backend, operation_id, label);
    }
    let _ = window.emit(
        "whim:agent-event",
        json!({ "operationId": operation_id, "event": event_val.clone() }),
    );
    if !matches!(event, AgentEvent::Progress { .. }) {
        events.push(event_val);
    }
}

/// Lightweight live-only progress does not change the final result event
/// contract. It gives the desktop UI real activity before a command finishes.
pub(crate) fn emit_agent_progress<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    operation_id: &str,
    message: String,
) {
    record_agent_event(
        window,
        operation_id,
        &mut Vec::new(),
        AgentEvent::Progress { message },
    );
}

/// Reduce an untrusted provider event to one fixed, secret-free audit label.
/// The full event may include a prompt, a source snippet, a command, or tool
/// output, so it is deliberately kept out of the durable ledger. These labels
/// are the only agent-derived execution detail Whim persists by default.
pub(crate) fn durable_audit_label(event: &Value) -> Option<&'static str> {
    match event.get("type").and_then(Value::as_str) {
        Some("tool_use") => {
            let part = event.get("part")?;
            let tool = part.get("tool").and_then(Value::as_str)?;
            let failed = part
                .pointer("/state/status")
                .and_then(Value::as_str)
                .is_some_and(|status| status == "error");
            let completed = part
                .pointer("/state/status")
                .and_then(Value::as_str)
                .is_some_and(|status| status == "completed");
            if !failed && !completed {
                return None;
            }
            let label = match tool {
                "Read" => "workspace file read",
                "Write" => "workspace file write",
                "Edit" => "workspace file edit",
                "Glob" => "workspace directory listing",
                "Grep" => "workspace search",
                "Bash" => "workspace command",
                "Verify" => "verification command",
                "Background verification" => "background verification suite",
                "Plan" => "implementation plan",
                "Research" => "read-only research step",
                "Checkpoint" => "workspace checkpoint",
                "Rollback" => "workspace rollback",
                "Preview" => "local preview",
                "Tunnel" => "public tunnel",
                _ => return None,
            };
            Some(if failed {
                match label {
                    "workspace file read" => "Tool failed: workspace file read.",
                    "workspace file write" => "Tool failed: workspace file write.",
                    "workspace file edit" => "Tool failed: workspace file edit.",
                    "workspace directory listing" => "Tool failed: workspace directory listing.",
                    "workspace search" => "Tool failed: workspace search.",
                    "workspace command" => "Tool failed: workspace command.",
                    "verification command" => "Tool failed: verification command.",
                    "background verification suite" => {
                        "Tool failed: background verification suite."
                    }
                    "implementation plan" => "Tool failed: implementation plan.",
                    "read-only research step" => "Tool failed: read-only research step.",
                    "workspace checkpoint" => "Tool failed: workspace checkpoint.",
                    "workspace rollback" => "Tool failed: workspace rollback.",
                    "local preview" => "Tool failed: local preview.",
                    "public tunnel" => "Tool failed: public tunnel.",
                    _ => return None,
                }
            } else {
                match label {
                    "workspace file read" => "Completed: workspace file read.",
                    "workspace file write" => "Completed: workspace file write.",
                    "workspace file edit" => "Completed: workspace file edit.",
                    "workspace directory listing" => "Completed: workspace directory listing.",
                    "workspace search" => "Completed: workspace search.",
                    "workspace command" => "Completed: workspace command.",
                    "verification command" => "Completed: verification command.",
                    "background verification suite" => "Completed: background verification suite.",
                    "implementation plan" => "Completed: implementation plan.",
                    "read-only research step" => "Completed: read-only research step.",
                    "workspace checkpoint" => "Completed: workspace checkpoint.",
                    "workspace rollback" => "Completed: workspace rollback.",
                    "local preview" => "Completed: local preview.",
                    "public tunnel" => "Completed: public tunnel.",
                    _ => return None,
                }
            })
        }
        Some("error") => match event.pointer("/error/code").and_then(Value::as_str) {
            Some("CANCELLED") => Some("Native agent acknowledged cancellation."),
            Some("TIMEOUT") => Some("Stopped at the configured task time budget."),
            Some("PROVIDER") => {
                Some("Provider request failed; details remain in the live session.")
            }
            _ => Some("Native agent reported an error; details remain in the live session."),
        },
        _ => None,
    }
}

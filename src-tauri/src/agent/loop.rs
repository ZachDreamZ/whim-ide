//! Native agent run loop.
//!
//! Contains the main `run_native_agent` function, research sub-agent,
//! context-compaction helpers, budget/policy utilities, and stream reading.
//! Extracted from `agent.rs` in Phase 1.15.

use std::time::{Duration, Instant};
use std::path::{Path, PathBuf};

use futures::future::join_all;
use tokio::io::{AsyncRead, AsyncReadExt};
use serde_json::{json, Value};
use tauri::{Manager, State, WebviewWindow};

use crate::backend::settings::AppSettings;
use crate::backend::{AgentRunResult, BackendState, CommandResult};
use crate::harness::HarnessProfile;
use crate::agent::provider::{AgentRole, Provider, provider_name};
use crate::agent::events::{
    emit_agent_progress, record_agent_event, AgentEvent, AgentErrorDetail,
    ReasoningPart, ToolUsePart, ToolUseState,
};
use crate::agent::transport::chat_with_retry;
use crate::agent::background::{
    append_background_report, background_check_specs, background_verification_allowed,
    BackgroundVerifier,
};
use crate::agent::loop_detector::LoopDetector;
use crate::agent::tools::{read_only_tool_defs, tool_defs_for_profile, tool_display};
use crate::agent::execution::{cap_output, run_tool};
use crate::agent::prompt::{build_system_prompt, project_memory_for_run};

const RESEARCH_MAX_ITERS: usize = 6;
const MAX_CONTEXT_CHARS: usize = 80_000;
const KEEP_RECENT_MESSAGES: usize = 8;
const MAX_RECOVERY_ITERS: usize = 5;
pub(crate) const MAX_PROVIDER_RETRIES: usize = 3;

#[allow(clippy::too_many_arguments)]
async fn run_research(
    state: State<'_, BackendState>,
    provider: Provider,
    base: &str,
    api_key: &Option<String>,
    model: &str,
    question: &str,
    scope: &str,
    root: &Path,
    profile: &HarnessProfile,
    operation_id: &str,
) -> (String, bool) {
    let system = format!(
        "You are a read-only research sub-agent inside the workspace at: {}\n\
You investigate a question by reading files, listing directories, and grepping. You NEVER write files or run commands.\n\
Be thorough but concise. At the end, produce a tight summary with file:line references and concrete findings.\n\
Windows environment; relative paths only.",
        root.display()
    );
    let tools = read_only_tool_defs(profile);
    let mut messages: Vec<Value> = vec![json!({
        "role": "user",
        "content": format!(
            "Investigate: {question}{}",
            if scope.is_empty() { String::new() } else { format!(" (scope: {scope})") }
        )
    })];
    let mut notes = String::new();
    for _ in 0..RESEARCH_MAX_ITERS {
        if crate::backend::is_operation_cancelled(state.inner(), operation_id).await {
            return ("Research cancelled with the parent task.".into(), true);
        }
        let response =
            match chat_with_retry(provider, base, api_key, model, &system, &messages, &tools).await
            {
                Ok(response) => response,
                Err(error) => return (format!("research failed: {error}"), true),
            };
        if let Some(text) = &response.text {
            if !text.trim().is_empty() {
                notes.push_str(text);
                notes.push('\n');
            }
        }
        let mut assistant = json!({
            "role": "assistant",
            "content": response.text.clone().unwrap_or_default()
        });
        if !response.tool_calls.is_empty() {
            assistant["tool_calls"] = json!(response
                .tool_calls
                .iter()
                .map(|call| json!({
                    "id": call.id,
                    "type": "function",
                    "function": { "name": call.name, "arguments": call.arguments.to_string() }
                }))
                .collect::<Vec<_>>());
        }
        messages.push(assistant);
        if response.tool_calls.is_empty() {
            break;
        }
        for call in &response.tool_calls {
            if crate::backend::is_operation_cancelled(state.inner(), operation_id).await {
                return ("Research cancelled with the parent task.".into(), true);
            }
            let (output, is_error) = run_tool(
                state.clone(),
                &call.name,
                &call.arguments,
                root,
                profile,
                AgentRole::Planner,
            )
            .await;
            if is_error {
                notes.push_str(&format!("[tool error] {output}\n"));
            }
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": output
            }));
        }
    }
    if notes.trim().is_empty() {
        return ("No findings.".to_string(), false);
    }
    let summary_prompt = format!(
        "Summarize the following research notes into a concise bullet list with file:line references. Keep only what answers the question.\n\n{notes}"
    );
    let summary_messages = vec![json!({ "role": "user", "content": summary_prompt })];
    match chat_with_retry(
        provider,
        base,
        api_key,
        model,
        &system,
        &summary_messages,
        &tools,
    )
    .await
    {
        Ok(response) => {
            let summary = response.text.unwrap_or_else(|| notes.clone());
            (cap_output(summary), false)
        }
        Err(_) => (cap_output(notes), false),
    }


fn approx_chars(messages: &[Value]) -> usize {
    messages
        .iter()
        .map(|message| message.to_string().chars().count())
        .sum()

/// while keeping the original task and the most recent turns intact.
async fn compact_messages(
    provider: Provider,
    base: &str,
    api_key: &Option<String>,
    model: &str,
    messages: Vec<Value>,
    plan_reminder: &str,
) -> Vec<Value> {
    if messages.len() <= KEEP_RECENT_MESSAGES + 2 {
        return messages;
    }
    let head = messages[0].clone();
    let n = messages.len();
    let tail: Vec<Value> = messages[n - KEEP_RECENT_MESSAGES..].to_vec();
    let middle: Vec<Value> = messages[1..n - KEEP_RECENT_MESSAGES].to_vec();
    let middle_text = middle
        .iter()
        .map(|message| {
            let role = message["role"].as_str().unwrap_or("?");
            let content = message["content"].as_str().unwrap_or("");
            format!(
                "[{role}] {}\n",
                content.chars().take(1500).collect::<String>()
            )
        })
        .collect::<Vec<_>>()
        .join("---\n");
    let summary = summarize(provider, base, api_key, model, &middle_text).await;
    let summary_content = if plan_reminder.is_empty() {
        format!("Summary of earlier agent steps:\n{summary}")
    } else {
        format!("Summary of earlier agent steps:\n{summary}\n\n{plan_reminder}")
    };
    let mut out = vec![head, json!({ "role": "user", "content": summary_content })];
    out.extend(tail);
    out


async fn summarize(
    provider: Provider,
    base: &str,
    api_key: &Option<String>,
    model: &str,
    middle_text: &str,
) -> String {
    let system = "You compress coding-agent conversation history into a terse summary that preserves: files read/edited, decisions made, errors hit, and remaining plan steps. No preamble.";
    let messages = vec![json!({
        "role": "user",
        "content": format!("Compress this agent history:\n{middle_text}")
    })];
    match chat_with_retry(provider, base, api_key, model, system, &messages, &[]).await {
        Ok(response)
            if response
                .text
                .as_ref()
                .map(|text| !text.trim().is_empty())
                .unwrap_or(false) =>
        {
            response.text.unwrap()
        }
        _ => middle_text.chars().take(4000).collect::<String>(),
    }


async fn read_limited_stream<R>(reader: R) -> (String, bool)
where
    R: AsyncRead + Unpin,
{
    let limit = crate::backend::MAX_PROCESS_OUTPUT_BYTES;
    let mut bytes = Vec::new();
    let mut limited = reader.take((limit + 1) as u64);
    let _ = limited.read_to_end(&mut bytes).await;
    let truncated = bytes.len() > limit;
    bytes.truncate(limit);
    (String::from_utf8_lossy(&bytes).into_owned(), truncated)


fn tool_may_change_workspace(name: &str) -> bool {
    matches!(
        name,
        "write_file" | "edit_file" | "run_command" | "rollback"
    )


fn tool_iteration_budget(_mode: AgentRole, _speed: &str) -> Option<usize> {
    // No fixed iteration cap. The native agent continues until the model
    // returns no tool calls (normal completion), the user cancels, a fatal
    // error occurs, or behavioral loop detection asks the parent to revise.
    // A harness profile or request may still set an *advisory* budget that only
    // produces a warning, never an automatic stop.
    None


fn remaining_agent_budget(start: Instant, total_timeout_ms: u64) -> Option<Duration> {
    let elapsed_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    total_timeout_ms
        .checked_sub(elapsed_ms)
        .filter(|remaining| *remaining > 0)
        .map(Duration::from_millis)


#[allow(clippy::too_many_arguments)]
async fn run_native_agent<R: tauri::Runtime>(
    app: &WebviewWindow<R>,
    state: State<'_, BackendState>,
    root: PathBuf,
    provider: Provider,
    base: &str,
    api_key: &Option<String>,
    model: &str,
    prompt: &str,
    mode: AgentRole,
    auto_continue: bool,
    timeout_ms: u64,
    operation_id: &str,
    session_id: &Option<String>,
    profile: &HarnessProfile,
    profile_configured: bool,
    settings: &AppSettings,
    owns_operation: bool,
) -> Result<AgentRunResult, String> {
    let start = Instant::now();
    let root_display = root.to_string_lossy().into_owned();
    crate::backend::workspace::ensure_project_agent_context_at(&root)?;
    let tools = tool_defs_for_profile(profile, mode, settings);
    let memory = project_memory_for_run(&root, settings);
    let system = build_system_prompt(
        &root_display,
        &memory,
        mode.as_str(),
        profile_configured.then_some(profile),
        settings,
    );
    let mut messages: Vec<Value> = vec![json!({ "role": "user", "content": prompt })];
    let mut events: Vec<Value> = Vec::new();
    let mut combined_stdout = String::new();
    let mut plan_items: Vec<String> = Vec::new();
    let mut recovery_count: usize = 0;
    let mut provider_retry: usize = 0;
    let total_timeout = timeout_ms;
    let speed_iteration_cap = tool_iteration_budget(mode, settings.agent.speed.as_str());
    let tool_iteration_cap: Option<usize> = profile.tool_iteration_cap(speed_iteration_cap);
    // The iteration count is recorded for telemetry only. It must never stop
    // a healthy run â€” see LoopDetector for behavioral loop detection.
    if let Some(advisory_cap) = tool_iteration_cap {
        // Distinguishable from the normal agent lifecycle: this is an optional
        // administrator/request budget that only warns. A healthy run keeps
        // going past this count under parent-controlled completion.
        record_agent_event(
            app,
            operation_id,
            &mut events,
            AgentEvent::Warning {
                code: "ADVISORY_ITERATION_BUDGET".into(),
                message: format!(
                    "Advisory tool-iteration budget of {advisory_cap} configured. This is a warning signal only; the run continues under parent-controlled completion and is never stopped merely for reaching this count."
                ),
            },
        );
    }

    // Register in the backend operation registry so cancel_operation can find
    // this agent run and set the cancelled flag. Registration also takes an
    // execution-root lease, so two autonomous writers cannot race in one
    // workspace while separate Git worktrees remain independently runnable.
    if owns_operation {
        if let Err(error) =
            crate::backend::register_agent_operation(&state, operation_id, "native-agent", &root).await
        {
            return Err(format!("Cannot register agent operation: {error}"));
        }
    }
    emit_agent_progress(
        app,
        operation_id,
        "Native agent started; preparing the first model request.".to_string(),
    );
    let mut background_verifier = if background_verification_allowed(mode, settings, profile) {
        let checks = background_check_specs(&root);
        (!checks.is_empty())
            .then(|| BackgroundVerifier::new(app.clone(), root.clone(), operation_id, checks))
    } else {
        None
    };
    let mut last_background_generation = 0_u64;
    let mut last_background_success: Option<bool> = None;
    if profile_configured {
        record_agent_event(
            app,
            operation_id,
            &mut events,
            AgentEvent::Text {
                text: profile.event_summary(),
            },
        );
    }

    let mut iter: usize = 0;
    let mut _pending_tools = false;
    let mut loop_detector = LoopDetector::new();
    let mut reported_loop_repeats: usize = 0;
    'agent_loop: loop {
        // Behavioral loop detection: identical repeated tool calls with
        // identical results are reported as evidence to the parent, never used
        // to stop the run. The parent/main agent decides whether to revise.
        if let Some(repeats) = loop_detector.detected_repeats() {
            if repeats > reported_loop_repeats {
                reported_loop_repeats = repeats;
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::Warning {
                        code: "POSSIBLE_LOOP".into(),
                        message: format!(
                            "Possible non-progress loop: the same tool call repeated {repeats} times with identical arguments and result. Continue only if new state is being produced; otherwise revise the approach or cancel."
                        ),
                    },
                );
            }
        }
        iter += 1;
        // Check whether the user cancelled this run before making another
        // provider request or executing further tools.
        if crate::backend::is_operation_cancelled(&state, operation_id).await {
            record_agent_event(
                app,
                operation_id,
                &mut events,
                AgentEvent::Error {
                    error: AgentErrorDetail {
                        code: Some("CANCELLED".into()),
                        message: "Agent run cancelled by user".into(),
                    },
                },
            );
            break;
        }

        if remaining_agent_budget(start, total_timeout).is_none() {
            record_agent_event(
                app,
                operation_id,
                &mut events,
                AgentEvent::Error {
                    error: AgentErrorDetail {
                        code: Some("TIMEOUT".into()),
                        message: "Agent run timed out".into(),
                    },
                },
            );
            break;
        }
        if let Some(verifier) = background_verifier.as_mut() {
            if let Some(report) = verifier.poll_ready().await {
                last_background_generation = report.generation;
                last_background_success = Some(report.success());
                append_background_report(app, operation_id, &mut messages, &mut events, &report);
            }
        }
        if approx_chars(&messages) > MAX_CONTEXT_CHARS && iter >= 2 {
            let reminder = if plan_items.is_empty() {
                String::new()
            } else {
                format!(
                    "Current plan still in progress:\n{}",
                    plan_items
                        .iter()
                        .enumerate()
                        .map(|(index, step)| format!("{}. {step}", index + 1))
                        .collect::<Vec<_>>()
                        .join("\n")
                )
            };
            let Some(remaining) = remaining_agent_budget(start, total_timeout) else {
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::Error {
                        error: AgentErrorDetail {
                            code: Some("TIMEOUT".into()),
                            message: "Agent run timed out while compacting context".into(),
                        },
                    },
                );
                break;
            };
            messages = match tokio::time::timeout(
                remaining,
                compact_messages(provider, base, api_key, model, messages, &reminder),
            )
            .await
            {
                Ok(compacted) => compacted,
                Err(_) => {
                    record_agent_event(
                        app,
                        operation_id,
                        &mut events,
                        AgentEvent::Error {
                            error: AgentErrorDetail {
                                code: Some("TIMEOUT".into()),
                                message: "Agent run timed out while compacting context".into(),
                            },
                        },
                    );
                    break;
                }
            };
        }
        emit_agent_progress(
            app,
            operation_id,
            "Requesting a model response.".to_string(),
        );
        let Some(remaining) = remaining_agent_budget(start, total_timeout) else {
            record_agent_event(
                app,
                operation_id,
                &mut events,
                AgentEvent::Error {
                    error: AgentErrorDetail {
                        code: Some("TIMEOUT".into()),
                        message: "Agent run timed out before the model responded".into(),
                    },
                },
            );
            break;
        };
        let response = match tokio::time::timeout(
            remaining,
            chat_with_retry(provider, base, api_key, model, &system, &messages, &tools),
        )
        .await
        {
            Err(_) => {
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::Error {
                        error: AgentErrorDetail {
                            code: Some("TIMEOUT".into()),
                            message: "Agent run timed out while waiting for the model".into(),
                        },
                    },
                );
                break;
            }
            Ok(result) => match result {
                Ok(response) => response,
                Err(error) => {
                    let is_client = ["400", "401", "403", "404", "422"]
                        .iter()
                        .any(|code| error.contains(code));
                    if !is_client && auto_continue && provider_retry < MAX_PROVIDER_RETRIES {
                        provider_retry += 1;
                        continue;
                    }
                    record_agent_event(
                        app,
                        operation_id,
                        &mut events,
                        AgentEvent::Error {
                            error: AgentErrorDetail {
                                code: Some("PROVIDER".into()),
                                message: error,
                            },
                        },
                    );
                    break;
                }
            },
        };
        if let Some(text) = &response.text {
            if !text.trim().is_empty() {
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::Text { text: text.clone() },
                );
                combined_stdout.push_str(text);
                combined_stdout.push('\n');
            }
        }
        if let Some(reasoning) = &response.reasoning {
            if !reasoning.trim().is_empty() {
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::Reasoning {
                        part: ReasoningPart {
                            text: reasoning.clone(),
                        },
                    },
                );
            }
        }
        let mut assistant = json!({
            "role": "assistant",
            "content": response.text.clone().unwrap_or_default()
        });
        if !response.tool_calls.is_empty() {
            assistant["tool_calls"] = json!(response
                .tool_calls
                .iter()
                .map(|call| json!({
                    "id": call.id,
                    "type": "function",
                    "function": { "name": call.name, "arguments": call.arguments.to_string() }
                }))
                .collect::<Vec<_>>());
        }
        messages.push(assistant);
        _pending_tools = !response.tool_calls.is_empty();
        if response.tool_calls.is_empty() {
            if let Some(verifier) = background_verifier.as_mut() {
                if verifier.needs_fresh_report(last_background_generation) {
                    let elapsed_ms = start.elapsed().as_millis() as u64;
                    let remaining_ms = total_timeout.saturating_sub(elapsed_ms).max(1);
                    match tokio::time::timeout(
                        Duration::from_millis(remaining_ms),
                        verifier.wait_latest(),
                    )
                    .await
                    {
                        Ok(Some(report)) => {
                            last_background_generation = report.generation;
                            last_background_success = Some(report.success());
                            append_background_report(
                                app,
                                operation_id,
                                &mut messages,
                                &mut events,
                                &report,
                            );
                            continue;
                        }
                        Ok(None) => {}
                        Err(_) => {
                            record_agent_event(
                                app,
                                operation_id,
                                &mut events,
                                AgentEvent::Error {
                                    error: AgentErrorDetail {
                                        code: Some("BACKGROUND_VERIFICATION_TIMEOUT".into()),
                                        message: "Background verification did not finish before the agent deadline".into(),
                                    },
                                },
                            );
                            break;
                        }
                    }
                }
            }
            let saw_error = events
                .iter()
                .any(|e| e.get("type").and_then(Value::as_str) == Some("error"));
            if saw_error && auto_continue && recovery_count < MAX_RECOVERY_ITERS {
                let error_messages: Vec<String> = events
                    .iter()
                    .filter_map(|e| {
                        if e.get("type").and_then(Value::as_str) == Some("error") {
                            e.pointer("/error/message")
                                .and_then(Value::as_str)
                                .map(String::from)
                        } else {
                            None
                        }
                    })
                    .collect();
                let nudge = format!(
                    "You are not finished. The previous steps reported {} error(s):\n{}\nReview the error output, fix the root cause, and continue. Do not end your turn until the task is complete and any verification you ran passes.",
                    error_messages.len(),
                    error_messages.join("\n")
                );
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::Text {
                        text: format!("[auto-continue] {nudge}"),
                    },
                );
                messages.push(json!({ "role": "user", "content": nudge }));
                recovery_count += 1;
                continue;
            }
            break;
        }
        for call in &response.tool_calls {
            emit_agent_progress(
                app,
                operation_id,
                format!("Running {}.", tool_display(&call.name)),
            );
            if !mode.permits_tool(&call.name) {
                let output = format!(
                    "Tool '{}' is disabled by {} mode policy.",
                    call.name,
                    mode.as_str()
                );
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::ToolUse {
                        part: ToolUsePart {
                            id: call.id.clone(),
                            tool: tool_display(&call.name),
                            state: ToolUseState {
                                status: "error".into(),
                                input: call.arguments.clone(),
                                output: Some(Value::String(output.clone())),
                                error: None,
                            },
                        },
                    },
                );
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": output
                }));
                continue;
            }
            if !profile.permits_tool(&call.name) {
                let output = format!(
                    "Tool '{}' is disabled by the active {HARNESS_PROFILE_PATH} policy.",
                    call.name
                );
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::ToolUse {
                        part: ToolUsePart {
                            id: call.id.clone(),
                            tool: tool_display(&call.name),
                            state: ToolUseState {
                                status: "error".into(),
                                input: call.arguments.clone(),
                                output: Some(Value::String(output.clone())),
                                error: None,
                            },
                        },
                    },
                );
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": output
                }));
                continue;
            }

            if call.name == "delegate_task" {
                let role_str = call
                    .arguments
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("implementer");
                let task = call
                    .arguments
                    .get("task")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let sub_role = AgentRole::parse(Some(role_str)).unwrap_or(AgentRole::Implementer);

                emit_agent_progress(
                    app,
                    operation_id,
                    format!("Delegating task to {}...", sub_role.as_str()),
                );

                let remaining_ms = remaining_agent_budget(start, total_timeout)
                    .map(|remaining| remaining.as_millis().min(u128::from(u64::MAX)) as u64)
                    .unwrap_or(1);
                let recursive_result = Box::pin(run_native_agent(
                    app,
                    app.state::<BackendState>(),
                    root.clone(),
                    provider,
                    base,
                    api_key,
                    model,
                    task,
                    sub_role,
                    auto_continue,
                    remaining_ms,
                    operation_id,
                    session_id,
                    profile,
                    profile_configured,
                    settings,
                    false,
                ))
                .await;

                let outcome = match recursive_result {
                    Ok(res) => {
                        let final_msg = res
                            .events
                            .iter()
                            .rev()
                            .find_map(|e| {
                                let event: Result<AgentEvent, _> =
                                    serde_json::from_value(e.clone());
                                if let Ok(AgentEvent::Text { text }) = event {
                                    Some(text)
                                } else {
                                    None
                                }
                            })
                            .unwrap_or_else(|| "Completed with no final message.".to_string());
                        format!(
                            "Delegated task completed successfully.\nResult:\n{}",
                            final_msg
                        )
                    }
                    Err(e) => format!("Delegated task failed:\n{}", e),
                };

                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::ToolUse {
                        part: ToolUsePart {
                            id: call.id.clone(),
                            tool: "Delegate Task".into(),
                            state: ToolUseState {
                                status: "completed".into(),
                                input: call.arguments.clone(),
                                output: Some(Value::String(outcome.clone())),
                                error: None,
                            },
                        },
                    },
                );
                loop_detector.observe("delegate_task", &call.arguments, &outcome);

                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": outcome
                }));
                continue;
            }

            if call.name == "plan" {
                let steps = call
                    .arguments
                    .get("steps")
                    .and_then(|value| value.as_array())
                    .cloned()
                    .unwrap_or_default();
                let items: Vec<String> = steps
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_string))
                    .collect();
                if !items.is_empty() {
                    plan_items = items;
                }
                let rendered = plan_items
                    .iter()
                    .enumerate()
                    .map(|(index, step)| format!("{}. {}", index + 1, step))
                    .collect::<Vec<_>>()
                    .join("\n");
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::ToolUse {
                        part: ToolUsePart {
                            id: call.id.clone(),
                            tool: "Plan".into(),
                            state: ToolUseState {
                                status: "completed".into(),
                                input: call.arguments.clone(),
                                output: Some(Value::String(format!("Plan:\n{rendered}"))),
                                error: None,
                            },
                        },
                    },
                );
                loop_detector.observe("plan", &call.arguments, &rendered);
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": format!("Plan recorded with {} steps.", plan_items.len())
                }));
                continue;
            }
            if call.name == "research" {
                let question = call
                    .arguments
                    .get("question")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let scope = call
                    .arguments
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let mut questions = call
                    .arguments
                    .get("questions")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .take(settings.agent.max_parallel_agents as usize)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if questions.is_empty() {
                    questions.push(question);
                }
                let workspace = root.to_string_lossy().into_owned();
                let mut child_jobs = Vec::new();
                for (index, item) in questions.iter().enumerate() {
                    let child_operation = format!("{operation_id}:r:{}:{}", call.id, index + 1);
                    let started_at = Instant::now();
                    let created = crate::backend::lock(&state.orchestration, "orchestration").await.and_then(|mut store| {
                        let job = store.create(crate::orchestrator::CreateJobInput {
                            workspace: workspace.clone(),
                            intent: format!("Read-only research stream for parent operation {operation_id}: {item}"),
                            title: Some(format!("Research: {item}")),
                            mode: crate::orchestrator::JobMode::Research,
                            operation_id: Some(child_operation),
                            provider: Some(provider_name(provider).to_string()),
                            model: Some(model.to_string()),
                            max_duration_ms: Some(5 * 60 * 1000),
                        })?;
                        store.transition(&workspace, &job.id, crate::orchestrator::JobAction::Start)
                    });
                    child_jobs.push(created.ok().map(|job| (job.id, started_at)));
                }
                let research = join_all(questions.iter().map(|item| {
                    run_research(
                        state.clone(),
                        provider,
                        base,
                        api_key,
                        model,
                        item,
                        &scope,
                        &root,
                        profile,
                        operation_id,
                    )
                }));
                let Some(remaining) = remaining_agent_budget(start, total_timeout) else {
                    record_agent_event(
                        app,
                        operation_id,
                        &mut events,
                        AgentEvent::Error {
                            error: AgentErrorDetail {
                                code: Some("TIMEOUT".into()),
                                message: "Agent run timed out before research completed".into(),
                            },
                        },
                    );
                    break 'agent_loop;
                };
                let results = match tokio::time::timeout(remaining, research).await {
                    Ok(results) => results,
                    Err(_) => {
                        record_agent_event(
                            app,
                            operation_id,
                            &mut events,
                            AgentEvent::Error {
                                error: AgentErrorDetail {
                                    code: Some("TIMEOUT".into()),
                                    message: "Agent run timed out while research was running"
                                        .into(),
                                },
                            },
                        );
                        break 'agent_loop;
                    }
                };
                if let Ok(mut store) = crate::backend::lock(&state.orchestration, "orchestration").await {
                    for (index, (text, failed)) in results.iter().enumerate() {
                        let Some((job_id, started_at)) =
                            child_jobs.get(index).and_then(Option::as_ref)
                        else {
                            continue;
                        };
                        let cancelled =
                            crate::backend::is_operation_cancelled(state.inner(), operation_id).await;
                        let outcome = if cancelled {
                            crate::orchestrator::JobOutcome::Cancelled
                        } else if *failed {
                            crate::orchestrator::JobOutcome::Failed
                        } else {
                            crate::orchestrator::JobOutcome::Completed
                        };
                        let _ = store.finish(
                            &workspace,
                            job_id,
                            outcome,
                            Some(text.clone()),
                            crate::orchestrator::JobEvidence {
                                event_count: 2,
                                tool_call_count: 0,
                                failed_tool_call_count: u32::from(*failed),
                                duration_ms: Some(
                                    started_at.elapsed().as_millis().min(u128::from(u64::MAX))
                                        as u64,
                                ),
                                timed_out: false,
                            },
                        );
                    }
                }
                let is_error = results.iter().all(|(_, failed)| *failed);
                let output = results
                    .into_iter()
                    .enumerate()
                    .map(|(index, (text, _))| format!("## Research stream {}\n{}", index + 1, text))
                    .collect::<Vec<_>>()
                    .join("\n\n");
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::ToolUse {
                        part: ToolUsePart {
                            id: call.id.clone(),
                            tool: "Research".into(),
                            state: ToolUseState {
                                status: if is_error {
                                    "error".into()
                                } else {
                                    "completed".into()
                                },
                                input: call.arguments.clone(),
                                output: Some(Value::String(output.clone())),
                                error: None,
                            },
                        },
                    },
                );
                loop_detector.observe("research", &call.arguments, &output);
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": output
                }));
                continue;
            }
            let Some(remaining) = remaining_agent_budget(start, total_timeout) else {
                record_agent_event(
                    app,
                    operation_id,
                    &mut events,
                    AgentEvent::Error {
                        error: AgentErrorDetail {
                            code: Some("TIMEOUT".into()),
                            message: format!(
                                "Agent run timed out before {} could run",
                                tool_display(&call.name)
                            ),
                        },
                    },
                );
                break 'agent_loop;
            };
            let tool_result = tokio::time::timeout(
                remaining,
                run_tool(
                    state.clone(),
                    &call.name,
                    &call.arguments,
                    &root,
                    profile,
                    mode,
                ),
            )
            .await;
            let (output, is_error) = match tool_result {
                Ok(result) => result,
                Err(_) => {
                    record_agent_event(
                        app,
                        operation_id,
                        &mut events,
                        AgentEvent::Error {
                            error: AgentErrorDetail {
                                code: Some("TIMEOUT".into()),
                                message: format!(
                                    "Agent run timed out while {} was running",
                                    tool_display(&call.name)
                                ),
                            },
                        },
                    );
                    break 'agent_loop;
                }
            };
            // Behavioral loop detection observes every completed tool call.
            loop_detector.observe(&call.name, &call.arguments, &output);
            record_agent_event(
                app,
                operation_id,
                &mut events,
                AgentEvent::ToolUse {
                    part: ToolUsePart {
                        id: call.id.clone(),
                        tool: tool_display(&call.name),
                        state: ToolUseState {
                            status: if is_error {
                                "error".into()
                            } else {
                                "completed".into()
                            },
                            input: call.arguments.clone(),
                            output: Some(Value::String(output.clone())),
                            error: None,
                        },
                    },
                },
            );
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": output
            }));
            if !is_error && tool_may_change_workspace(&call.name) {
                if let Some(verifier) = background_verifier.as_mut() {
                    verifier.mark_workspace_changed();
                }
            }
        }
    }

    if last_background_success == Some(false)
        && !events.iter().any(|event| {
            event.get("type").and_then(Value::as_str) == Some("error")
                && event.pointer("/error/code").and_then(Value::as_str)
                    == Some("BACKGROUND_VERIFICATION")
        })
    {
        record_agent_event(
            app,
            operation_id,
            &mut events,
            AgentEvent::Error {
                error: AgentErrorDetail {
                    code: Some("BACKGROUND_VERIFICATION".into()),
                    message: format!(
                        "Background verification generation {last_background_generation} still has failing checks"
                    ),
                },
            },
        );
    }
    if let Some(verifier) = background_verifier.as_mut() {
        verifier.shutdown().await;
    }

    // Derive success/failure from events rather than hardcoding success=true.
    // Any error-type event pushes success to false and populates stderr with
    // the collected error messages so the frontend can surface them.
    let has_error = events
        .iter()
        .any(|e| e.get("type").and_then(Value::as_str) == Some("error"));
    let stderr: String = events
        .iter()
        .filter_map(|e| {
            if e.get("type").and_then(Value::as_str) == Some("error") {
                e.pointer("/error/message")
                    .and_then(Value::as_str)
                    .map(String::from)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let timed_out = has_error
        && events.iter().any(|e| {
            e.get("type").and_then(Value::as_str) == Some("error")
                && e.pointer("/error/message")
                    .and_then(Value::as_str)
                    .is_some_and(|m| m.contains("timed out"))
        });

    // Capture cancellation flag BEFORE finish_operation removes the registry
    // entry. After removal, is_operation_cancelled returns false regardless.
    let was_cancelled = crate::backend::is_operation_cancelled(&state, operation_id).await;

    // Clean up the operation registry entry regardless of how the run exits.
    if owns_operation {
        crate::backend::finish_operation(&state, operation_id).await;
    }

    Ok(AgentRunResult {
        events,
        malformed_event_lines: 0,
        session_id: session_id.clone(),
        model_id: Some(model.to_string()),
        command: CommandResult {
            operation_id: operation_id.to_string(),
            command: "whim-native-agent".to_string(),
            cwd: root_display,
            success: !has_error,
            exit_code: if has_error { Some(1) } else { Some(0) },
            stdout: combined_stdout,
            stderr,
            stdout_truncated: false,
            stderr_truncated: false,
            timed_out,
            cancelled: was_cancelled,
            duration_ms: start.elapsed().as_millis(),
        },
        iteration_count: iter,
        loop_warnings: reported_loop_repeats,
    })


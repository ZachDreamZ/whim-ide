//! Native external agent harness: Eve HTTP runtime, Codex/Claude subprocess
//! output parsing, and the external-harness tool/mutation policy.
//!
//! This leaf of the `agent` subsystem owns the Eve session types and stream
//! event application, the Eve HTTP turn + cancellation, the per-runtime output
//! text parsers, and the `pi`/`external` tool-allowlist and mutation-policy
//! helpers. It depends on `tauri`, `serde_json`, `reqwest`, and the
//! `crate::agent::{provider, events}` and `crate::{backend, capabilities,
//! harness}` modules, but on no other `agent::*` leaf.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::WebviewWindow;

use crate::agent::events::{emit_agent_progress, record_agent_event, AgentEvent, ReasoningPart};
use crate::agent::provider::AgentRole;
use crate::backend::settings::AppSettings;
use crate::capabilities::{capability_allows_tool, resolved_capabilities};
use crate::harness::HarnessProfile;

pub(crate) fn pi_tool_allowlist(mode: AgentRole, profile: &HarnessProfile, settings: &AppSettings) -> String {
    if mode == AgentRole::Chat {
        return String::new();
    }
    let capabilities = resolved_capabilities(settings, mode.as_str());
    // Pi's built-in edit/write tools cannot enforce Whim's per-path prefixes.
    // Fail closed whenever a profile narrows write paths instead of granting
    // broader workspace authority than the native harness would have.
    let unrestricted_write_paths = profile.allowed_write_paths.is_none();
    let can_write = unrestricted_write_paths
        && mode.permits_tool("write_file")
        && profile.permits_tool("write_file")
        && settings.agent.approval_policy == "risky"
        && capability_allows_tool(&capabilities, "write_file");
    let can_edit = unrestricted_write_paths
        && mode.permits_tool("edit_file")
        && profile.permits_tool("edit_file")
        && settings.agent.approval_policy == "risky"
        && capability_allows_tool(&capabilities, "edit_file");
    let can_shell = mode.permits_tool("run_command")
        && profile.permits_tool("run_command")
        && settings.agent.approval_policy == "risky"
        && capability_allows_tool(&capabilities, "run_command");
    let mut tool_names = vec!["read", "grep", "find", "ls"];
    if can_shell {
        tool_names.push("bash");
    }
    if can_edit {
        tool_names.push("edit");
    }
    if can_write {
        tool_names.push("write");
    }
    tool_names.join(",")
}

pub(crate) fn external_harness_can_mutate(
    mode: AgentRole,
    profile: &HarnessProfile,
    settings: &AppSettings,
) -> bool {
    profile.allowed_tools.is_none()
        && profile.allowed_write_paths.is_none()
        && settings.agent.approval_policy == "risky"
        && mode.permits_tool("edit_file")
        && mode.permits_tool("write_file")
        && capability_allows_tool(&resolved_capabilities(settings, mode.as_str()), "edit_file")
}

pub(crate) fn external_runtime_can_mutate(
    runtime: &str,
    mode: AgentRole,
    profile: &HarnessProfile,
    settings: &AppSettings,
) -> bool {
    runtime == "codex" && external_harness_can_mutate(mode, profile, settings)
}

pub(crate) fn codex_output_text(stdout: &str) -> Option<String> {
    let mut text = None;
    for line in stdout.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if event_type == "item.completed" {
            let item = value.get("item").unwrap_or(&Value::Null);
            if item.get("type").and_then(Value::as_str) == Some("agent_message") {
                if let Some(candidate) = item.get("text").and_then(Value::as_str) {
                    text = Some(candidate.to_string());
                }
            }
        }
        if let Some(candidate) = value.get("text").and_then(Value::as_str) {
            text = Some(candidate.to_string());
        }
    }
    text.filter(|value| !value.trim().is_empty())
}

pub(crate) fn claude_output_text(stdout: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(stdout).ok()?;
    value
        .get("result")
        .and_then(Value::as_str)
        .or_else(|| value.get("text").and_then(Value::as_str))
        .map(ToOwned::to_owned)
        .filter(|value| !value.trim().is_empty())
}

pub(crate) fn plain_output_text(stdout: &str) -> Option<String> {
    let text = stdout.trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn stage_antigravity_prompt(root: &Path, prompt: &str) -> Result<(PathBuf, String), String> {
    use std::io::Write as _;

    let relative_directory = Path::new(".whim/context/external-prompts");
    let directory =
        crate::backend::workspace::ensure_directory_chain(root, relative_directory, true)?;
    let file_name = format!("agy-{}.md", uuid::Uuid::new_v4());
    let relative_path = relative_directory.join(&file_name);
    let prompt_path = directory.join(file_name);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&prompt_path)
        .map_err(|error| format!("Could not securely stage Antigravity input: {error}"))?;
    if let Err(error) = file.write_all(prompt.as_bytes()) {
        drop(file);
        let _ = std::fs::remove_file(&prompt_path);
        return Err(format!("Could not stage Antigravity input: {error}"));
    }
    Ok((
        prompt_path,
        relative_path.to_string_lossy().replace('\\', "/"),
    ))
}

fn bounded_external_error(stderr: &str, stdout: &str, runtime: &str) -> String {
    let detail = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    if detail.trim().is_empty() {
        format!("{runtime} returned no assistant output")
    } else {
        detail.trim().chars().take(2_000).collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct EveSessionCursor {
    session_id: String,
    continuation_token: String,
    stream_index: u64,
}

#[derive(Debug)]
struct EveTurnOutcome {
    events: Vec<Value>,
    assistant_text: String,
    cursor: EveSessionCursor,
    model: Option<String>,
    failure: Option<String>,
}

#[derive(Default)]
struct EveStreamState {
    events: Vec<Value>,
    assistant_text: String,
    emitted_text: bool,
    continuation_token: Option<String>,
    failure: Option<String>,
    stream_index: u64,
}

const MAX_EVE_CONTROL_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_EVE_STREAM_BYTES: usize = 8 * 1024 * 1024;
const MAX_EVE_STREAM_EVENTS: usize = 10_000;
const MAX_EVE_ASSISTANT_BYTES: usize = 1024 * 1024;

fn safe_eve_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
}

fn encode_eve_cursor(cursor: &EveSessionCursor) -> Result<String, String> {
    serde_json::to_string(cursor).map_err(|error| format!("Cannot preserve Eve session: {error}"))
}

fn valid_eve_loopback_url(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(value).ok()?;
    if url.scheme() != "http"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
    {
        return None;
    }
    Some(value.trim_end_matches('/').to_string())
}

fn find_eve_server_url(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in ["serverUrl", "url"] {
                if let Some(url) = map
                    .get(key)
                    .and_then(Value::as_str)
                    .and_then(valid_eve_loopback_url)
                {
                    return Some(url);
                }
            }
            map.values().find_map(find_eve_server_url)
        }
        Value::Array(values) => values.iter().find_map(find_eve_server_url),
        _ => None,
    }
}

fn eve_info_model(info: &Value) -> Option<String> {
    info.pointer("/agent/model/id")
        .and_then(Value::as_str)
        .or_else(|| info.get("model").and_then(Value::as_str))
        .or_else(|| info.pointer("/model/id").and_then(Value::as_str))
        .filter(|model| !model.is_empty())
        .map(str::to_string)
}

fn eve_error_message(event: &Value) -> Option<String> {
    event
        .pointer("/data/error/message")
        .or_else(|| event.pointer("/data/message"))
        .and_then(Value::as_str)
        .map(|message| message.chars().take(2_000).collect())
}

fn apply_eve_stream_event<R: tauri::Runtime>(
    app: &WebviewWindow<R>,
    operation_id: &str,
    event: Value,
    state: &mut EveStreamState,
) -> Result<bool, String> {
    state.stream_index = state.stream_index.saturating_add(1);
    match event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "message.appended" => {
            if let Some(delta) = event
                .pointer("/data/messageDelta")
                .or_else(|| event.pointer("/data/delta"))
                .and_then(Value::as_str)
                .filter(|delta| !delta.is_empty())
            {
                if state.assistant_text.len().saturating_add(delta.len()) > MAX_EVE_ASSISTANT_BYTES
                {
                    return Err("Eve assistant output exceeds the safe size limit".into());
                }
                state.assistant_text.push_str(delta);
                state.emitted_text = true;
                record_agent_event(
                    app,
                    operation_id,
                    &mut state.events,
                    AgentEvent::Text { text: delta.into() },
                );
            }
        }
        "message.completed" => {
            let finish_reason = event.pointer("/data/finishReason").and_then(Value::as_str);
            if finish_reason != Some("tool-calls") {
                if let Some(message) = event.pointer("/data/message").and_then(Value::as_str) {
                    if message.len() > MAX_EVE_ASSISTANT_BYTES {
                        return Err("Eve assistant output exceeds the safe size limit".into());
                    }
                    state.assistant_text = message.to_string();
                    if !state.emitted_text && !message.trim().is_empty() {
                        record_agent_event(
                            app,
                            operation_id,
                            &mut state.events,
                            AgentEvent::Text {
                                text: message.into(),
                            },
                        );
                    }
                }
            }
        }
        "reasoning.appended" => {
            if let Some(delta) = event
                .pointer("/data/reasoningDelta")
                .or_else(|| event.pointer("/data/delta"))
                .and_then(Value::as_str)
                .filter(|delta| !delta.is_empty())
            {
                record_agent_event(
                    app,
                    operation_id,
                    &mut state.events,
                    AgentEvent::Reasoning {
                        part: ReasoningPart { text: delta.into() },
                    },
                );
            }
        }
        "actions.requested" => emit_agent_progress(
            app,
            operation_id,
            "Eve requested sandbox or authored tool actions.".into(),
        ),
        "action.result" => emit_agent_progress(
            app,
            operation_id,
            "An Eve action completed at a durable step boundary.".into(),
        ),
        "input.requested" => {
            let message = "Eve is waiting for human input. Reply with the requested answer, or `approve` / `deny` for an approval.".to_string();
            state.assistant_text = message.clone();
            record_agent_event(
                app,
                operation_id,
                &mut state.events,
                AgentEvent::Text { text: message },
            );
            return Ok(true);
        }
        "authorization.required" => {
            let url = event
                .pointer("/data/authorization/url")
                .and_then(Value::as_str)
                .filter(|url| url.starts_with("https://"));
            let message = match url {
                Some(url) => format!("Eve paused for connection authorization: {url}"),
                None => "Eve paused for connection authorization. Open the Eve client to complete sign-in.".into(),
            };
            state.assistant_text = message.clone();
            record_agent_event(
                app,
                operation_id,
                &mut state.events,
                AgentEvent::Text { text: message },
            );
            return Ok(false);
        }
        "step.failed" | "turn.failed" | "session.failed" => {
            state.failure = Some(
                eve_error_message(&event)
                    .unwrap_or_else(|| "Eve reported a failed durable turn".into()),
            );
            if event.get("type").and_then(Value::as_str) == Some("session.failed") {
                return Ok(true);
            }
        }
        "session.waiting" => {
            state.continuation_token = event
                .pointer("/data/continuationToken")
                .and_then(Value::as_str)
                .map(str::to_string);
            return Ok(true);
        }
        "session.completed" => return Ok(true),
        _ => {}
    }
    Ok(false)
}

async fn eve_json_response(
    mut response: reqwest::Response,
    label: &str,
) -> Result<(reqwest::StatusCode, Value), String> {
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Cannot read {label}: {error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_EVE_CONTROL_RESPONSE_BYTES {
            return Err(format!("{label} exceeds the safe response size limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value =
        serde_json::from_slice(&bytes).map_err(|error| format!("Cannot parse {label}: {error}"))?;
    Ok((status, value))
}

async fn run_eve_http_turn<R: tauri::Runtime>(
    app: &WebviewWindow<R>,
    client: &reqwest::Client,
    base: &str,
    prompt: &str,
    previous: Option<EveSessionCursor>,
    operation_id: &str,
    active_session: &std::sync::Mutex<Option<String>>,
) -> Result<EveTurnOutcome, String> {
    let info_response = client
        .get(format!("{base}/eve/v1/info"))
        .send()
        .await
        .map_err(|error| format!("Cannot reach the local Eve runtime at {base}: {error}"))?;
    let (info_status, info) = eve_json_response(info_response, "Eve runtime info").await?;
    if !info_status.is_success() {
        return Err(format!(
            "Local Eve runtime rejected inspection with HTTP {}",
            info_status
        ));
    }
    let model = eve_info_model(&info);
    let (post_url, body, start_index, fallback_session, fallback_token) = match previous {
        Some(cursor) => (
            format!("{base}/eve/v1/session/{}", cursor.session_id),
            json!({
                "continuationToken": cursor.continuation_token.clone(),
                "message": prompt,
            }),
            cursor.stream_index,
            Some(cursor.session_id),
            Some(cursor.continuation_token),
        ),
        None => (
            format!("{base}/eve/v1/session"),
            json!({ "message": prompt }),
            0,
            None,
            None,
        ),
    };
    let response = client
        .post(post_url)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Eve session request failed: {error}"))?;
    let (response_status, metadata) = eve_json_response(response, "Eve session response").await?;
    if !response_status.is_success() {
        return Err(format!(
            "Eve session returned HTTP {response_status}: {metadata}"
        ));
    }
    let session_id = metadata
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(fallback_session)
        .ok_or_else(|| "Eve did not return a sessionId".to_string())?;
    if !safe_eve_session_id(&session_id) {
        return Err("Eve returned an unsafe sessionId".into());
    }
    let initial_token = metadata
        .get("continuationToken")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(fallback_token)
        .ok_or_else(|| "Eve did not return a continuationToken".to_string())?;
    if initial_token.len() > 4_096 {
        return Err("Eve returned an oversized continuationToken".into());
    }
    if let Ok(mut active) = active_session.lock() {
        *active = Some(session_id.clone());
    }
    emit_agent_progress(
        app,
        operation_id,
        format!("Connected to Eve durable session {session_id}."),
    );
    let mut response = client
        .get(format!(
            "{base}/eve/v1/session/{session_id}/stream?startIndex={start_index}"
        ))
        .send()
        .await
        .map_err(|error| format!("Cannot open Eve session stream: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Eve session stream returned HTTP {}",
            response.status()
        ));
    }
    let mut state = EveStreamState {
        stream_index: start_index,
        ..EveStreamState::default()
    };
    let mut buffer = Vec::<u8>::new();
    let mut boundary = false;
    let mut received_bytes = 0_usize;
    let mut received_events = 0_usize;
    while !boundary {
        let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Eve session stream failed: {error}"))?
        else {
            break;
        };
        received_bytes = received_bytes.saturating_add(chunk.len());
        if received_bytes > MAX_EVE_STREAM_BYTES {
            return Err("Eve session stream exceeds the safe size limit".into());
        }
        buffer.extend_from_slice(&chunk);
        if buffer.len() > MAX_EVE_CONTROL_RESPONSE_BYTES && !buffer.contains(&b'\n') {
            return Err("Eve emitted an oversized NDJSON event".into());
        }
        while let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
            let line = buffer.drain(..=newline).collect::<Vec<_>>();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let event = serde_json::from_str::<Value>(line)
                .map_err(|error| format!("Eve emitted invalid NDJSON: {error}"))?;
            received_events = received_events.saturating_add(1);
            if received_events > MAX_EVE_STREAM_EVENTS {
                return Err("Eve session stream emitted too many events".into());
            }
            boundary = apply_eve_stream_event(app, operation_id, event, &mut state)?;
            if boundary {
                break;
            }
        }
    }
    if !boundary && !buffer.iter().all(u8::is_ascii_whitespace) {
        let event = serde_json::from_slice::<Value>(&buffer)
            .map_err(|error| format!("Eve ended with invalid NDJSON: {error}"))?;
        boundary = apply_eve_stream_event(app, operation_id, event, &mut state)?;
    }
    if !boundary {
        return Err("Eve session stream ended before a durable turn boundary".into());
    }
    let continuation_token = state.continuation_token.unwrap_or(initial_token);
    Ok(EveTurnOutcome {
        events: state.events,
        assistant_text: state.assistant_text,
        cursor: EveSessionCursor {
            session_id,
            continuation_token,
            stream_index: state.stream_index,
        },
        model,
        failure: state.failure,
    })
}

async fn cancel_eve_turn(base: &str, session_id: Option<String>) {
    let Some(session_id) = session_id.filter(|id| safe_eve_session_id(id)) else {
        return;
    };
    if let Ok(client) = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(5))
        .no_proxy()
        .build()
    {
        let _ = client
            .post(format!("{base}/eve/v1/session/{session_id}/cancel"))
            .send()
            .await;
    }
}

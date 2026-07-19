//! Provider-neutral chat transport for the native agent.
//!
//! This leaf owns the OpenAI-compatible / Anthropic / Google chat calls and the
//! shared `ModelResponse`/`ToolCall` shapes and retry wrapper. It depends on
//! `crate::agent::{provider, tools}` and `reqwest`; the run loop drives it
//! through `chat_with_retry` and `run_model_chat` (the latter stays in
//! `agent.rs` and calls `chat`).

use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::sleep;

use crate::agent::MAX_PROVIDER_RETRIES;
use crate::agent::provider::{resolve_key, Provider};
use crate::agent::tools::ToolDef;

pub(crate) struct ModelResponse {
    pub(crate) text: Option<String>,
    pub(crate) reasoning: Option<String>,
    pub(crate) tool_calls: Vec<ToolCall>,
}

pub(crate) struct ToolCall {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) arguments: Value,
}

pub(crate) async fn chat(
    provider: Provider,
    base: &str,
    api_key: &Option<String>,
    model: &str,
    system: &str,
    messages: &[Value],
    tools: &[ToolDef],
) -> Result<ModelResponse, String> {
    // Resolve the key once so every provider-specific transport authenticates
    // correctly, including auto-detected providers whose key lives in the env.
    let resolved_key = resolve_key(provider, api_key);
    match provider {
        Provider::OpenAi
        | Provider::OpenCode
        | Provider::Local
        | Provider::DeepSeek
        | Provider::Xiaomi
        | Provider::Qwen
        | Provider::OmniRoute
        | Provider::Compatible
        | Provider::ZenMux
        | Provider::XAi
        | Provider::OrcaRouter => {
            chat_openai_style(base, &resolved_key, model, system, messages, tools).await
        }
        Provider::Anthropic => {
            chat_anthropic(base, &resolved_key, model, system, messages, tools).await
        }
        Provider::Google => chat_google(base, &resolved_key, model, system, messages, tools).await,
    }
}

/// Retry transient provider errors (timeouts, 5xx, connection resets). Client
/// errors (4xx) are returned immediately since retrying will not help.
pub(crate) async fn chat_with_retry(
    provider: Provider,
    base: &str,
    api_key: &Option<String>,
    model: &str,
    system: &str,
    messages: &[Value],
    tools: &[ToolDef],
) -> Result<ModelResponse, String> {
    let client_errors = ["400", "401", "403", "404", "422"];
    let mut last_error: Option<String> = None;
    for attempt in 0..MAX_PROVIDER_RETRIES {
        match chat(provider, base, api_key, model, system, messages, tools).await {
            Ok(response) => return Ok(response),
            Err(error) => {
                if client_errors.iter().any(|code| error.contains(code)) {
                    return Err(error);
                }
                last_error = Some(error);
                // Exponential backoff with jitter (Codex/OpenHands pattern):
                // only transient (5xx/network) failures reach here; 4xx returns
                // immediately above.
                if attempt + 1 < MAX_PROVIDER_RETRIES {
                    let base_ms = 350u64.saturating_mul(1u64 << attempt);
                    let jitter = (std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|duration| duration.subsec_nanos())
                        .unwrap_or(0) as u64)
                        % (base_ms / 2 + 1);
                    sleep(std::time::Duration::from_millis(base_ms + jitter)).await;
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "Provider request failed repeatedly".to_string()))
}

fn build_openai_messages(system: &str, messages: &[Value]) -> Vec<Value> {
    let mut out = vec![json!({ "role": "system", "content": system })];
    out.extend(messages.iter().cloned());
    out
}

async fn chat_openai_style(
    base: &str,
    api_key: &Option<String>,
    model: &str,
    system: &str,
    messages: &[Value],
    tools: &[ToolDef],
) -> Result<ModelResponse, String> {
    if base.trim().is_empty() {
        return Err("A base URL is required for this provider (set baseUrl)".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Cannot build HTTP client: {error}"))?;
    let mut body = json!({
        "model": model,
        "messages": build_openai_messages(system, messages),
        "temperature": 0.2,
    });
    if !tools.is_empty() {
        body["tools"] = json!(tools
            .iter()
            .map(|tool| json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            }))
            .collect::<Vec<_>>());
        body["tool_choice"] = json!("auto");
    }
    let mut request = client
        .post(format!("{}/chat/completions", base.trim_end_matches('/')))
        .json(&body);
    if let Some(key) = api_key.as_ref().filter(|key| !key.is_empty()) {
        request = request.bearer_auth(key);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Provider request failed: {error}"))?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|error| format!("Cannot parse provider response: {error}"))?;
    if !status.is_success() {
        return Err(format!("Provider error {}: {}", status, value));
    }
    let message = &value["choices"][0]["message"];
    let text = message["content"].as_str().map(str::to_string);
    let mut tool_calls = Vec::new();
    if let Some(calls) = message["tool_calls"].as_array() {
        for call in calls {
            let name = call["function"]["name"].as_str().unwrap_or("").to_string();
            let args_str = call["function"]["arguments"].as_str().unwrap_or("{}");
            let arguments = serde_json::from_str::<Value>(args_str).unwrap_or_else(|_| json!({}));
            let id = call["id"].as_str().unwrap_or("call").to_string();
            tool_calls.push(ToolCall {
                id,
                name,
                arguments,
            });
        }
    }
    Ok(ModelResponse {
        text,
        reasoning: None,
        tool_calls,
    })
}

fn build_anthropic_messages(messages: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for message in messages {
        let role = message["role"].as_str().unwrap_or("user");
        if role == "tool" {
            let tool_use_id = message["tool_call_id"].as_str().unwrap_or("").to_string();
            let content = message["content"].as_str().unwrap_or("").to_string();
            if let Some(last) = out.last_mut() {
                if last["role"].as_str() == Some("user") && last["content"].is_array() {
                    last["content"].as_array_mut().unwrap().push(json!({
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": content
                    }));
                    continue;
                }
            }
            out.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": content
                }]
            }));
            continue;
        }
        if role == "assistant" {
            let mut content_blocks = Vec::new();
            if let Some(text) = message["content"].as_str() {
                if !text.is_empty() {
                    content_blocks.push(json!({ "type": "text", "text": text }));
                }
            }
            if let Some(calls) = message["tool_calls"].as_array() {
                for call in calls {
                    let name = call["function"]["name"].as_str().unwrap_or("").to_string();
                    let arguments = serde_json::from_str::<Value>(
                        call["function"]["arguments"].as_str().unwrap_or("{}"),
                    )
                    .unwrap_or_else(|_| json!({}));
                    content_blocks.push(json!({
                        "type": "tool_use",
                        "id": call["id"].as_str().unwrap_or(""),
                        "name": name,
                        "input": arguments
                    }));
                }
            }
            out.push(json!({ "role": "assistant", "content": content_blocks }));
            continue;
        }
        out.push(json!({
            "role": "user",
            "content": message["content"].as_str().unwrap_or("").to_string()
        }));
    }
    out
}

async fn chat_anthropic(
    base: &str,
    api_key: &Option<String>,
    model: &str,
    system: &str,
    messages: &[Value],
    tools: &[ToolDef],
) -> Result<ModelResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Cannot build HTTP client: {error}"))?;
    let mut body = json!({
        "model": model,
        "max_tokens": 8192,
        "system": system,
        "messages": build_anthropic_messages(messages),
    });
    if !tools.is_empty() {
        body["tools"] = json!(tools
            .iter()
            .map(|tool| json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters
            }))
            .collect::<Vec<_>>());
    }
    let mut request = client
        .post(format!("{}/v1/messages", base.trim_end_matches('/')))
        .json(&body)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json");
    if let Some(key) = api_key.as_ref().filter(|key| !key.is_empty()) {
        request = request.header("x-api-key", key);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Provider request failed: {error}"))?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|error| format!("Cannot parse provider response: {error}"))?;
    if !status.is_success() {
        return Err(format!("Provider error {}: {}", status, value));
    }
    let mut text = None;
    let mut reasoning = None;
    let mut tool_calls = Vec::new();
    if let Some(blocks) = value["content"].as_array() {
        for block in blocks {
            match block["type"].as_str() {
                Some("text") => {
                    text = block["text"].as_str().map(str::to_string);
                }
                Some("thinking") => {
                    reasoning = block["thinking"].as_str().map(str::to_string);
                }
                Some("tool_use") => {
                    let name = block["name"].as_str().unwrap_or("").to_string();
                    let arguments = block["input"].clone();
                    let id = block["id"].as_str().unwrap_or("call").to_string();
                    tool_calls.push(ToolCall {
                        id,
                        name,
                        arguments,
                    });
                }
                _ => {}
            }
        }
    }
    Ok(ModelResponse {
        text,
        reasoning,
        tool_calls,
    })
}

fn build_google_contents(messages: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for message in messages {
        let role = message["role"].as_str().unwrap_or("user");
        if role == "tool" {
            let name = message["tool_call_id"].as_str().unwrap_or("").to_string();
            let result = message["content"].as_str().unwrap_or("").to_string();
            out.push(json!({
                "role": "user",
                "parts": [{
                    "functionResponse": {
                        "name": name,
                        "response": { "content": result }
                    }
                }]
            }));
            continue;
        }
        if role == "assistant" {
            let mut parts = Vec::new();
            if let Some(text) = message["content"].as_str() {
                if !text.is_empty() {
                    parts.push(json!({ "text": text }));
                }
            }
            if let Some(calls) = message["tool_calls"].as_array() {
                for call in calls {
                    let name = call["function"]["name"].as_str().unwrap_or("").to_string();
                    let arguments = serde_json::from_str::<Value>(
                        call["function"]["arguments"].as_str().unwrap_or("{}"),
                    )
                    .unwrap_or_else(|_| json!({}));
                    parts.push(json!({ "functionCall": { "name": name, "args": arguments } }));
                }
            }
            out.push(json!({ "role": "model", "parts": parts }));
            continue;
        }
        out.push(json!({
            "role": "user",
            "parts": [{ "text": message["content"].as_str().unwrap_or("").to_string() }]
        }));
    }
    out
}

async fn chat_google(
    base: &str,
    api_key: &Option<String>,
    model: &str,
    system: &str,
    messages: &[Value],
    tools: &[ToolDef],
) -> Result<ModelResponse, String> {
    if base.trim().is_empty() {
        return Err("A base URL is required for this provider (set baseUrl)".to_string());
    }
    let model_name = model.split('/').next_back().unwrap_or(model);
    let url = format!(
        "{}/v1beta/models/{}:generateContent",
        base.trim_end_matches('/'),
        model_name,
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Cannot build HTTP client: {error}"))?;
    let mut body = json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": build_google_contents(messages),
        "generationConfig": { "temperature": 0.2 }
    });
    if !tools.is_empty() {
        body["tools"] = json!({
            "functionDeclarations": tools
                .iter()
                .map(|tool| json!({
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }))
                .collect::<Vec<_>>()
        });
    }
    let mut request = client.post(url).json(&body);
    if let Some(key) = api_key.as_ref().filter(|key| !key.is_empty()) {
        request = request.header("x-goog-api-key", key);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Provider request failed: {error}"))?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|error| format!("Cannot parse provider response: {error}"))?;
    if !status.is_success() {
        return Err(format!("Provider error {}: {}", status, value));
    }
    let mut text = None;
    let mut tool_calls = Vec::new();
    if let Some(parts) = value["candidates"][0]["content"]["parts"].as_array() {
        for (index, part) in parts.iter().enumerate() {
            if let Some(t) = part["text"].as_str() {
                text = Some(t.to_string());
            }
            if let Some(call) = part["functionCall"].as_object() {
                let name = call
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let arguments = call.get("args").cloned().unwrap_or_else(|| json!({}));
                tool_calls.push(ToolCall {
                    id: format!("call_{index}"),
                    name,
                    arguments,
                });
            }
        }
    }
    Ok(ModelResponse {
        text,
        reasoning: None,
        tool_calls,
    })
}
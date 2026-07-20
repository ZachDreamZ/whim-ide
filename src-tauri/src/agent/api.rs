//! Provider API: model listing, agent prompt dispatch, and model chat calls.

use std::path::Path;

use serde::Deserialize;
use serde_json::Value;
use tauri::{State, WebviewWindow};

use crate::backend::{AgentRunResult, BackendState, ReadFileRequest};
use crate::harness::{HarnessProfile, HARNESS_PROFILE_PATH, MAX_PROFILE_BYTES};

use super::provider::{
    default_base, default_model, first_local_model, parse_provider, provider_env_var,
    provider_label, provider_name, provider_requires_key, resolve_key, validate_provider_base,
    AgentRole, Provider,
};
use super::transport::chat;
use super::r#loop::run_native_agent;

const MIN_AGENT_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_AGENT_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const MAX_AGENT_TIMEOUT_MS: u64 = 30 * 60 * 1000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRequest {
    pub prompt: String,
    /// Optional execution target. Native validation accepts only the currently
    /// selected workspace or a Git-registered worktree of that repository.
    pub workspace: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub agent: Option<String>,
    pub session_id: Option<String>,
    pub operation_id: String,
    pub timeout_ms: Option<u64>,
    pub auto_approve: Option<bool>,
    pub auto_approve_confirmed: Option<bool>,
    pub auto_continue: Option<bool>,
}

/// A project may commit `whim.harness.json` to constrain its own agent runs.
/// Missing profiles are optional; malformed or escaping profiles fail closed
/// instead of silently weakening the expected execution policy.
pub(crate) fn load_harness_profile(root: &Path) -> Result<(HarnessProfile, bool), String> {
    let path = root.join(HARNESS_PROFILE_PATH);
    if !path.exists() {
        return Ok((HarnessProfile::default(), false));
    }
    let file = crate::backend::read_workspace_file_at(
        root,
        ReadFileRequest {
            path: HARNESS_PROFILE_PATH.to_string(),
            max_bytes: Some(MAX_PROFILE_BYTES),
        },
    )
    .map_err(|error| format!("Cannot read {HARNESS_PROFILE_PATH}: {error}"))?;
    let profile = HarnessProfile::parse(&file.content)?;
    Ok((profile, true))
}

/// Fetch available model IDs from a provider's API. Powers the provider-card
/// model dropdown once an API key (and base URL, where required) is supplied.
/// Returns an empty list on auth/transport failure so the UI falls back to a
/// free-text field instead of blocking configuration.
pub async fn fetch_provider_models(
    provider: &str,
    api_key: &str,
    base_url: Option<&str>,
) -> Result<Vec<String>, String> {
    let provider_enum = parse_provider(provider).map_err(|error| error.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Cannot build HTTP client: {error}"))?;
    let api_key = api_key.trim();

    match provider_enum {
        Provider::Anthropic => {
            if api_key.is_empty() {
                return Err("An API key is required to list Anthropic models.".into());
            }
            let response = client
                .get("https://api.anthropic.com/v1/models")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .send()
                .await
                .map_err(|error| format!("Anthropic models request failed: {error}"))?;
            let status = response.status();
            let value: Value = response
                .json()
                .await
                .map_err(|error| format!("Cannot parse Anthropic response: {error}"))?;
            if !status.is_success() {
                return Err(format!("Anthropic error {status}: {value}"));
            }
            let ids = value["models"]
                .as_array()
                .map(|array| {
                    array
                        .iter()
                        .filter_map(|model| model["id"].as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            Ok(dedupe_model_ids(ids))
        }
        Provider::Google => {
            if api_key.is_empty() {
                return Err("An API key is required to list Google models.".into());
            }
            let base = base_url
                .filter(|base| !base.trim().is_empty())
                .unwrap_or("https://generativelanguage.googleapis.com");
            let base = validate_provider_base(provider_enum, base)?;
            let url = format!("{}/v1beta/models", base.trim_end_matches('/'));
            let response = client
                .get(&url)
                .header("x-goog-api-key", api_key)
                .send()
                .await
                .map_err(|error| format!("Google models request failed: {error}"))?;
            let status = response.status();
            let value: Value = response
                .json()
                .await
                .map_err(|error| format!("Cannot parse Google response: {error}"))?;
            if !status.is_success() {
                return Err(format!("Google error {status}: {value}"));
            }
            let ids = value["models"]
                .as_array()
                .map(|array| {
                    array
                        .iter()
                        .filter_map(|model| {
                            model["name"].as_str().map(|name| {
                                name.strip_prefix("models/").unwrap_or(name).to_string()
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(dedupe_model_ids(ids))
        }
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
            if api_key.is_empty() && provider_requires_key(provider_enum) {
                return Err("An API key is required to list these models.".into());
            }
            let mut base = base_url
                .filter(|base| !base.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| default_base(provider_enum).to_string());
            if base.trim().is_empty() {
                return Err("A base URL is required to list these models.".into());
            }
            base = validate_provider_base(provider_enum, &base)?;
            let url = format!("{}/models", base.trim_end_matches('/'));
            let mut request = client.get(&url);
            if !api_key.is_empty() {
                request = request.bearer_auth(api_key);
            }
            let response = request
                .send()
                .await
                .map_err(|error| format!("Models request failed: {error}"))?;
            let status = response.status();
            let value: Value = response
                .json()
                .await
                .map_err(|error| format!("Cannot parse models response: {error}"))?;
            if !status.is_success() {
                return Err(format!("Provider error {status}: {value}"));
            }
            let ids = value["data"]
                .as_array()
                .map(|array| {
                    array
                        .iter()
                        .filter_map(|model| model["id"].as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            Ok(dedupe_model_ids(ids))
        }
    }
}

fn dedupe_model_ids(mut ids: Vec<String>) -> Vec<String> {
    ids.sort();
    ids.dedup();
    ids
}

#[tauri::command]
pub async fn list_provider_models(
    provider: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<Vec<String>, String> {
    let provider_enum = parse_provider(&provider)?;
    let explicit_key = (!api_key.trim().is_empty()).then_some(api_key);
    let resolved_key = resolve_key(provider_enum, &explicit_key).unwrap_or_default();
    fetch_provider_models(&provider, &resolved_key, base_url.as_deref()).await
}

#[tauri::command]
pub async fn run_agent_prompt<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, BackendState>,
    request: AgentRunRequest,
) -> Result<AgentRunResult, String> {
    if request.prompt.trim().is_empty() {
        return Err("WHIM:AGENT_START|Prompt must not be empty".to_string());
    }
    if request.prompt.chars().count() > 200_000 {
        return Err("WHIM:AGENT_START|Prompt exceeds the 200000 character limit".to_string());
    }
    if request.auto_approve.unwrap_or(false) && !request.auto_approve_confirmed.unwrap_or(false) {
        return Err(
            "WHIM:AGENT_START|Agent auto-approve requires autoApproveConfirmed=true".to_string(),
        );
    }
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_AGENT_TIMEOUT_MS)
        .clamp(MIN_AGENT_TIMEOUT_MS, MAX_AGENT_TIMEOUT_MS);
    let mode = AgentRole::parse(request.agent.as_deref())
        .map_err(|error| format!("WHIM:AGENT_START|{error}"))?;
    let root = if mode == AgentRole::Chat {
        crate::backend::chat::chat_runtime_workspace()
            .map_err(|error| format!("WHIM:AGENT_START|{error}"))?
    } else {
        crate::backend::resolve_agent_workspace(
            state.inner(),
            request
                .workspace
                .as_deref()
                .filter(|value| !value.trim().is_empty()),
        )
        .await
        .map_err(|error| format!("WHIM:AGENT_START|{error}"))?
    };
    let (profile, profile_configured) =
        load_harness_profile(&root).map_err(|error| format!("WHIM:AGENT_START|{error}"))?;
    let timeout_ms = profile.duration_cap(timeout_ms);
    let settings = crate::backend::read_lock(&state.settings, "settings")
        .await
        .map_err(|error| format!("WHIM:AGENT_START|{error}"))?
        .clone();
    let provider_input = request.provider.clone().unwrap_or_default();
    let (provider, detected_base) = if provider_input.eq_ignore_ascii_case("auto")
        || provider_input.is_empty()
    {
        match crate::backend::auto_provider().await {
            Some((resolved, base)) => (parse_provider(&resolved).unwrap_or(Provider::Local), base),
            None => {
                return Err(
                    "WHIM:AGENT_START|No provider available. Run Ollama or LM Studio locally, connect OpenCode Zen, or set a supported cloud API key. Whim also reuses bounded API-key records from OpenCode's local auth store."
                        .to_string(),
                )
            }
        }
    } else {
        (
            parse_provider(&provider_input).map_err(|e| format!("WHIM:AGENT_START|{e}"))?,
            None,
        )
    };

    let model = if let Some(supplied) = request.model.clone().filter(|value| !value.is_empty()) {
        supplied
    } else if provider == Provider::Local {
        let base = detected_base
            .clone()
            .filter(|url| !url.is_empty())
            .unwrap_or_else(|| default_base(provider).to_string());
        match first_local_model(&base).await {
            Some(found) => found,
            None => return Err(
                "WHIM:AGENT_START|No local model found. Pull a model in Ollama/LM Studio (e.g. ollama pull llama3)."
                    .to_string(),
            ),
        }
    } else {
        default_model(provider, mode).to_string()
    };

    let mut base = request
        .base_url
        .clone()
        .filter(|url| !url.is_empty())
        .or(detected_base)
        .unwrap_or_else(|| default_base(provider).to_string());
    if base.trim().is_empty() {
        return Err("WHIM:AGENT_START|This provider requires a base URL (set baseUrl)".to_string());
    }
    base = validate_provider_base(provider, &base)
        .map_err(|error| format!("WHIM:AGENT_START|{error}"))?;
    let api_key = request.api_key.clone();
    if provider_requires_key(provider) && resolve_key(provider, &api_key).is_none() {
        return Err(format!(
            "WHIM:AGENT_START|API key required for {}. Open Providers, paste a key, set the {} env var, or connect an API key through OpenCode's local auth store.",
            provider_label(provider),
            provider_env_var(provider).unwrap_or("API key")
        ));
    }
    let auto_continue = request.auto_continue.unwrap_or(true);
    let operation_id = request.operation_id.clone();
    let session_id = request.session_id.clone();
    let janitor_workspace = root.to_string_lossy().into_owned();
    let janitor_runtime = crate::backend::reflector::JanitorRuntimeRequest {
        provider: Some(provider_name(provider).to_string()),
        model: Some(model.clone()),
        api_key: api_key.clone(),
        base_url: Some(base.clone()),
    };
    let result = run_native_agent(
        &window,
        state,
        root,
        provider,
        &base,
        &api_key,
        &model,
        &request.prompt,
        mode,
        auto_continue,
        timeout_ms,
        &operation_id,
        &session_id,
        &profile,
        profile_configured,
        &settings,
        true,
    )
    .await
    .map_err(|e| format!("WHIM:AGENT_RUN|{e}"))?;
    if result.command.success && !matches!(mode, AgentRole::Chat | AgentRole::Janitor) {
        crate::backend::reflector::spawn_janitor_if_needed(
            window,
            janitor_workspace,
            janitor_runtime,
        );
    }
    Ok(result)
}

/// Internal model chat call for sub-systems like the decomposer.
/// Returns the text response content, or an error.
pub(crate) async fn run_model_chat(
    provider: &str,
    model: &str,
    api_key: &str,
    base_url: &str,
    system: &str,
    messages: &[Value],
) -> Result<String, String> {
    let parsed = parse_provider(provider).map_err(|e| format!("Invalid provider '{provider}': {e}"))?;
    let base = if base_url.trim().is_empty() {
        default_base(parsed).to_string()
    } else {
        base_url.to_string()
    };
    let key = Some(api_key.to_string());
    let resolved_key = resolve_key(parsed, &key);
    if provider_requires_key(parsed) && resolved_key.is_none() {
        return Err(format!(
            "Provider '{provider}' requires an API key. Set the {}_API_KEY env var.",
            provider.to_uppercase()
        ));
    }
    let response = chat(parsed, &base, &resolved_key, model, system, messages, &[]).await?;
    response.text.ok_or_else(|| "Model returned no text response".to_string())
}

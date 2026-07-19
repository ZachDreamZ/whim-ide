//! Provider model, API-key resolution, base-URL validation, and model
//! discovery for the Whim native agent harness.
//!
//! This module is a leaf of the `agent` subsystem: it depends only on
//! `std`, `serde_json`, `dirs`, and `reqwest`, and on no other `agent::*`
//! module. Everything it exposes that the rest of the crate needs is
//! re-exported from `crate::agent`.

// The original `agent` module carried a blanket `allow(dead_code)` because many
// provider helpers are reachable only through dynamic dispatch / future wiring.
#![allow(dead_code)]

use std::time::Duration;

use serde_json::Value;

const MAX_STORED_API_KEY_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    OpenAi,
    Anthropic,
    Google,
    OpenCode,
    Local,
    DeepSeek,
    Xiaomi,
    Qwen,
    OmniRoute,
    Compatible,
    ZenMux,
    XAi,
    OrcaRouter,
}

pub fn parse_provider(value: &str) -> Result<Provider, String> {
    match value.to_ascii_lowercase().as_str() {
        "openai" => Ok(Provider::OpenAi),
        "anthropic" => Ok(Provider::Anthropic),
        "google" | "gemini" => Ok(Provider::Google),
        "opencode" | "opencode-zen" | "zen" => Ok(Provider::OpenCode),
        "local" | "ollama" | "lmstudio" => Ok(Provider::Local),
        "deepseek" => Ok(Provider::DeepSeek),
        "xiaomi" => Ok(Provider::Xiaomi),
        "qwen" => Ok(Provider::Qwen),
        "omniroute" | "omni-route" | "omni" => Ok(Provider::OmniRoute),
        "compatible" | "openai-compatible" | "openai_compatible" => Ok(Provider::Compatible),
        "zenmux" => Ok(Provider::ZenMux),
        "xai" | "grok" => Ok(Provider::XAi),
        "orcarouter" | "orca-router" | "orca" => Ok(Provider::OrcaRouter),
        other => Err(format!(
            "Unsupported agent provider '{other}'. Supported: openai, anthropic, google, opencode, qwen, deepseek, xiaomi, local, omniroute, compatible, zenmux, xai, orcarouter"
        )),
    }
}

pub(crate) fn provider_name(provider: Provider) -> &'static str {
    match provider {
        Provider::OpenAi => "openai",
        Provider::Anthropic => "anthropic",
        Provider::Google => "google",
        Provider::OpenCode => "opencode",
        Provider::Local => "local",
        Provider::DeepSeek => "deepseek",
        Provider::Xiaomi => "xiaomi",
        Provider::Qwen => "qwen",
        Provider::OmniRoute => "omniroute",
        Provider::Compatible => "compatible",
        Provider::ZenMux => "zenmux",
        Provider::XAi => "xai",
        Provider::OrcaRouter => "orcarouter",
    }
}

/// The mode is an enforced execution boundary, not merely a prompt label.
/// Planning and review cannot mutate a workspace; verification can only use
/// Whim's fixed, project-discovered verification commands. Build, vibe, and
/// ship retain the broader native tool set subject to the harness profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentRole {
    Chat,
    Auto,
    Planner,
    Researcher,
    Implementer,
    Reviewer,
    Tester,
    SecurityReviewer,
    Designer,
    Debugger,
    ReleaseAgent,
    Janitor,
    GameDesigner,
    TechArtist,
    Playtester,
    AssetGenerator,
    Refactorer,
    DataScientist,
    AccessibilityExpert,
    Localizer,
}

impl AgentRole {
    pub(crate) fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("auto").trim().to_ascii_lowercase().as_str() {
            "chat" => Ok(Self::Chat),
            "auto" | "orchestrator" | "vibe" => Ok(Self::Auto),
            "plan" | "planner" => Ok(Self::Planner),
            "research" | "researcher" => Ok(Self::Researcher),
            "build" | "implementer" => Ok(Self::Implementer),
            "verify" | "tester" => Ok(Self::Tester),
            "review" | "reviewer" => Ok(Self::Reviewer),
            "security" | "securityreviewer" => Ok(Self::SecurityReviewer),
            "design" | "designer" => Ok(Self::Designer),
            "debug" | "debugger" => Ok(Self::Debugger),
            "ship" | "releaseagent" => Ok(Self::ReleaseAgent),
            "janitor" => Ok(Self::Janitor),
            "gamedesigner" | "game_designer" => Ok(Self::GameDesigner),
            "techartist" | "tech_artist" => Ok(Self::TechArtist),
            "playtester" => Ok(Self::Playtester),
            "assetgenerator" | "asset_generator" => Ok(Self::AssetGenerator),
            "refactorer" | "architect" => Ok(Self::Refactorer),
            "datascientist" | "data_scientist" => Ok(Self::DataScientist),
            "accessibilityexpert" | "a11y" => Ok(Self::AccessibilityExpert),
            "localizer" => Ok(Self::Localizer),
            other => Err(format!(
                "Unsupported agent role '{other}'. Supported: chat, auto, planner, researcher, implementer, reviewer, tester, securityreviewer, designer, debugger, releaseagent, janitor, gamedesigner, techartist, playtester, assetgenerator, refactorer, datascientist, accessibilityexpert, localizer"
            )),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Auto => "auto",
            Self::Planner => "planner",
            Self::Researcher => "researcher",
            Self::Implementer => "implementer",
            Self::Reviewer => "reviewer",
            Self::Tester => "tester",
            Self::SecurityReviewer => "securityreviewer",
            Self::Designer => "designer",
            Self::Debugger => "debugger",
            Self::ReleaseAgent => "releaseagent",
            Self::Janitor => "janitor",
            Self::GameDesigner => "gamedesigner",
            Self::TechArtist => "techartist",
            Self::Playtester => "playtester",
            Self::AssetGenerator => "assetgenerator",
            Self::Refactorer => "refactorer",
            Self::DataScientist => "datascientist",
            Self::AccessibilityExpert => "accessibilityexpert",
            Self::Localizer => "localizer",
        }
    }

    pub(crate) fn permits_tool(self, name: &str) -> bool {
        match self {
            Self::Chat => false,
            // Public Vibe mode owns the requested outcome end to end. It can
            // inspect, research, implement, and verify directly, while still
            // retaining delegation as an optimization. Public tunneling stays
            // behind the explicit release/share flow.
            Self::Auto => name != "tunnel",
            Self::Planner | Self::Researcher | Self::SecurityReviewer | Self::GameDesigner => {
                matches!(
                    name,
                    "read_file" | "list_directory" | "grep_files" | "plan" | "research"
                )
            }
            Self::Reviewer => matches!(
                name,
                "read_file" | "list_directory" | "grep_files" | "plan" | "research" | "github"
            ),
            Self::Tester | Self::Playtester => matches!(
                name,
                "read_file" | "list_directory" | "grep_files" | "plan" | "research" | "verify"
            ),
            Self::Janitor => matches!(
                name,
                "read_file" | "list_directory" | "grep_files" | "plan" | "edit_file" | "verify"
            ),
            Self::Implementer
            | Self::Designer
            | Self::Debugger
            | Self::ReleaseAgent
            | Self::TechArtist
            | Self::AssetGenerator
            | Self::Refactorer
            | Self::DataScientist
            | Self::AccessibilityExpert
            | Self::Localizer => true,
        }
    }
}

/// Default API base per provider. Local/DeepSeek/Xiaomi/Qwen are OpenAI-compatible.
/// `base_url` from the request overrides this. `compatible` REQUIRES a base_url.
pub(crate) fn default_base(provider: Provider) -> &'static str {
    match provider {
        Provider::OpenAi => "https://api.openai.com/v1",
        Provider::Anthropic => "https://api.anthropic.com",
        Provider::Google => "https://generativelanguage.googleapis.com",
        Provider::OpenCode => "https://opencode.ai/zen/v1",
        Provider::Local => "http://127.0.0.1:11434/v1",
        Provider::DeepSeek => "https://api.deepseek.com",
        Provider::Xiaomi => "https://api.xiaomi.com/v1",
        Provider::Qwen => "https://dashscope.aliyuncs.com/compatible-mode/v1",
        Provider::OmniRoute => "http://127.0.0.1:20128/v1",
        Provider::Compatible => "",
        Provider::ZenMux => "https://zenmux.ai/api/v1",
        Provider::XAi => "https://api.x.ai/v1",
        Provider::OrcaRouter => "https://api.orcarouter.ai/v1",
    }
}

/// Human-readable provider name for error messages.
pub(crate) fn provider_label(provider: Provider) -> &'static str {
    match provider {
        Provider::OpenAi => "OpenAI",
        Provider::Anthropic => "Anthropic",
        Provider::Google => "Google Gemini",
        Provider::OpenCode => "OpenCode Zen",
        Provider::DeepSeek => "DeepSeek",
        Provider::Xiaomi => "Xiaomi",
        Provider::Qwen => "Qwen",
        Provider::OmniRoute => "OmniRoute",
        Provider::Local => "Local (Ollama / LM Studio)",
        Provider::Compatible => "OpenAI-Compatible",
        Provider::ZenMux => "ZenMux",
        Provider::XAi => "xAI (Grok)",
        Provider::OrcaRouter => "OrcaRouter",
    }
}

pub(crate) fn provider_request_is_auto(provider: Option<&str>) -> bool {
    provider.is_none_or(|value| value.trim().is_empty() || value.eq_ignore_ascii_case("auto"))
}

/// Well-known environment variables that may hold each provider's API key.
/// Keep aliases here so provider discovery, model listing, and agent runs all
/// agree without sending environment secrets through the renderer.
pub fn provider_environment_variables(provider: &str) -> &'static [&'static str] {
    match provider {
        "openai" => &["OPENAI_API_KEY"],
        "anthropic" => &["ANTHROPIC_API_KEY"],
        "google" => &[
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY",
            "GOOGLE_GENERATIVE_AI_API_KEY",
        ],
        "opencode" => &["OPENCODE_API_KEY"],
        "deepseek" => &["DEEPSEEK_API_KEY"],
        "qwen" => &["DASHSCOPE_API_KEY"],
        "xiaomi" => &["XIAOMI_API_KEY"],
        "omniroute" => &["OMNIROUTE_API_KEY"],
        "zenmux" => &["ZENMUX_API_KEY"],
        "xai" => &["XAI_API_KEY"],
        "orcarouter" => &["ORCAROUTER_API_KEY"],
        _ => &[],
    }
}

pub(crate) fn provider_env_var(provider: Provider) -> Option<&'static str> {
    provider_environment_variables(provider_name(provider))
        .first()
        .copied()
}

pub(crate) fn provider_requires_key(provider: Provider) -> bool {
    !matches!(
        provider,
        Provider::Local | Provider::OmniRoute | Provider::Compatible
    )
}

pub(crate) fn resolve_key_with(
    provider: Provider,
    api_key: &Option<String>,
    mut environment: impl FnMut(&str) -> Option<String>,
) -> Option<String> {
    if let Some(key) = api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
    {
        return Some(key.to_string());
    }

    for env_var in provider_environment_variables(provider_name(provider)) {
        if let Some(value) = environment(env_var) {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Resolve the API key to use: prefer the explicit in-session key, otherwise
/// fall back to a supported environment alias. This lets Vibe authenticate
/// without exposing native environment values to the webview.
pub(crate) fn resolve_key(provider: Provider, api_key: &Option<String>) -> Option<String> {
    resolve_key_with(provider, api_key, |name| std::env::var(name).ok())
        .or_else(|| stored_opencode_api_key(provider))
}

pub(crate) fn parse_stored_opencode_api_key(value: &Value, provider: Provider) -> Option<String> {
    let entry = value.get(provider_name(provider))?;
    if entry.get("type").and_then(Value::as_str) != Some("api") {
        return None;
    }
    let key = entry.get("key")?.as_str()?.trim();
    if key.is_empty() || key.len() > MAX_STORED_API_KEY_BYTES || key.chars().any(char::is_control) {
        return None;
    }
    Some(key.to_string())
}

/// Reuse API credentials already stored by OpenCode without sending the key to
/// the renderer. OAuth records are intentionally ignored because their token
/// lifecycles are provider-specific and must not be repurposed as API keys.
fn stored_opencode_api_key(provider: Provider) -> Option<String> {
    let path = dirs::home_dir()?.join(".local/share/opencode/auth.json");
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > crate::agent::MAX_OPENCODE_AUTH_BYTES
    {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&content).ok()?;
    parse_stored_opencode_api_key(&value, provider)
}

pub fn provider_key_available(provider: &str) -> bool {
    parse_provider(provider)
        .ok()
        .and_then(|parsed| resolve_key(parsed, &None))
        .is_some()
}

/// Sensible default model per provider so vibecoding needs no configuration
/// when the user has not named a specific model.
pub fn default_model(provider: Provider, role: AgentRole) -> &'static str {
    match provider {
        Provider::OpenAi => "gpt-4o-mini",
        Provider::Anthropic => "claude-3-5-sonnet-latest",
        Provider::Google => "gemini-1.5-flash",
        Provider::OpenCode => "deepseek-v4-flash-free",
        Provider::DeepSeek => "deepseek-chat",
        Provider::Xiaomi => "mixtral-8x7b-instruct",
        Provider::Qwen => "qwen-plus",
        Provider::Local => "llama3",
        Provider::OmniRoute => match role {
            AgentRole::Chat
            | AgentRole::Planner
            | AgentRole::Researcher
            | AgentRole::Reviewer
            | AgentRole::Tester
            | AgentRole::SecurityReviewer
            | AgentRole::Janitor => "auto/cheap",
            _ => "auto/coding",
        },
        Provider::Compatible => "local-model",
        Provider::ZenMux => "claude-3-5-sonnet-latest",
        Provider::XAi => "grok-4.5",
        Provider::OrcaRouter => "openai/gpt-4o-mini",
    }
}

/// OmniRoute is local by default. Plain HTTP is permitted only for an explicit
/// loopback host; remote gateways must use HTTPS so prompts and endpoint keys
/// cannot be sent over cleartext by a forged renderer request.
pub(crate) fn validate_omniroute_base(base: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(base.trim())
        .map_err(|error| format!("Invalid OmniRoute base URL: {error}"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("OmniRoute base URL must not contain embedded credentials".to_string());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let loopback = matches!(host.as_str(), "127.0.0.1" | "::1" | "localhost");
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(
            "OmniRoute must use loopback HTTP (127.0.0.1/localhost) or a remote HTTPS endpoint"
                .to_string(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub(crate) fn validate_provider_base(provider: Provider, base: &str) -> Result<String, String> {
    if provider == Provider::OmniRoute {
        return validate_omniroute_base(base);
    }
    let label = provider_label(provider);
    let url = reqwest::Url::parse(base.trim())
        .map_err(|error| format!("Invalid {label} base URL: {error}"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(format!(
            "{label} base URL must not contain embedded credentials"
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(format!(
            "{label} base URL must not contain a query or fragment"
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| format!("{label} base URL must include a host"))?
        .to_ascii_lowercase();
    let parsed_ip = host.parse::<std::net::IpAddr>().ok();
    let loopback = matches!(host.as_str(), "localhost")
        || parsed_ip
            .as_ref()
            .is_some_and(std::net::IpAddr::is_loopback);

    if provider == Provider::OpenCode && (url.scheme() != "https" || host != "opencode.ai") {
        return Err("OpenCode Zen must use the official https://opencode.ai endpoint".to_string());
    }

    if provider == Provider::Local {
        if !loopback || !matches!(url.scheme(), "http" | "https") {
            return Err(
                "Local model endpoints must use HTTP or HTTPS on localhost/127.0.0.1/::1"
                    .to_string(),
            );
        }
    } else if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(format!(
            "{label} must use HTTPS, except for an explicit loopback endpoint"
        ));
    }

    if provider == Provider::Compatible && !loopback {
        let private_ip = match parsed_ip {
            Some(std::net::IpAddr::V4(ip)) => {
                ip.is_private() || ip.is_link_local() || ip.is_unspecified()
            }
            Some(std::net::IpAddr::V6(ip)) => {
                ip.is_unique_local() || ip.is_unicast_link_local() || ip.is_unspecified()
            }
            None => false,
        };
        if private_ip {
            return Err(
                "OpenAI-compatible endpoints may not target non-loopback private IP addresses"
                    .to_string(),
            );
        }
    }

    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub(crate) async fn first_local_model(base: &str) -> Option<String> {
    let url = format!("{}/models", base.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;
    let response = client.get(&url).send().await.ok()?;
    let value: Value = response.json().await.ok()?;
    let data = value.get("data")?.as_array()?;
    for entry in data {
        if let Some(id) = entry.get("id").and_then(|inner| inner.as_str()) {
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

pub(crate) fn op_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("whim-{nanos}")
}

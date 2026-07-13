use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    fs::{self},
    path::{Path, PathBuf},
};
use tauri::State;

use super::BackendState;
use super::{MAX_DOTENV_FILE_BYTES, MAX_DOTENV_VALUE_BYTES};

use super::execution::{
    normalized_loopback_url, powershell_args, preferred_powershell, ps_quote, quick_capture,
    strip_ansi,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub available: bool,
    pub path: Option<String>,
    pub command_type: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolReport {
    pub git: Option<String>,
    pub node: Option<String>,
    pub npm: Option<String>,
    pub rustc: Option<String>,
    pub cargo: Option<String>,
    pub docker: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub os: String,
    pub arch: String,
    pub family: String,
    pub windows_version: Option<String>,
    pub powershell_version: Option<String>,
    pub home_directory: Option<String>,
    pub temp_directory: String,
    pub logical_cpus: usize,
    pub preferred_shell: String,
    pub tools: ToolReport,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawEnvironmentReport {
    pub windows_version: Option<String>,
    pub powershell_version: Option<String>,
    pub tools: ToolReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialPresence {
    pub provider: String,
    pub name: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialReport {
    pub entries: Vec<CredentialPresence>,
    pub scanned_sources: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProvidersRequest {
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProviderStatus {
    pub id: String,
    pub name: String,
    pub detected: bool,
    pub reachable: bool,
    pub endpoint: String,
    pub cli_path: Option<String>,
    pub models: Vec<LocalModel>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProvidersResult {
    pub providers: Vec<LocalProviderStatus>,
}

fn valid_tool_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
}

async fn resolve_tool(tool: &str, workspace: Option<&Path>) -> Result<ToolInfo, String> {
    if !valid_tool_name(tool) {
        return Err("Tool name contains unsupported characters".to_string());
    }

    if let Some(workspace) = workspace {
        for extension in ["cmd", "ps1", "exe", ""] {
            let file_name = if extension.is_empty() {
                tool.to_string()
            } else {
                format!("{tool}.{extension}")
            };
            let candidate = workspace.join("node_modules").join(".bin").join(file_name);
            if candidate.is_file() {
                return Ok(ToolInfo {
                    name: tool.to_string(),
                    available: true,
                    path: Some(candidate.to_string_lossy().into_owned()),
                    command_type: Some("workspace".to_string()),
                    version: None,
                });
            }
        }
    }

    let shell = preferred_powershell();
    let script = format!(
        "$command = Get-Command -Name {} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($command) {{ if ($command.Source) {{ $command.Source }} elseif ($command.Path) {{ $command.Path }} else {{ $command.Name }} }}",
        ps_quote(tool)
    );
    let (stdout, _, success) =
        quick_capture(&shell, &powershell_args(script, false), workspace, 5_000).await?;
    let path = stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(str::trim);

    Ok(ToolInfo {
        name: tool.to_string(),
        available: success && path.is_some(),
        path: path.map(ToOwned::to_owned),
        command_type: path.map(|_| "path".to_string()),
        version: None,
    })
}

fn unavailable_tool(name: &str) -> ToolInfo {
    ToolInfo {
        name: name.to_string(),
        available: false,
        path: None,
        command_type: None,
        version: None,
    }
}

fn clamp_timeout(value: Option<u64>, default: u64, maximum: u64) -> u64 {
    value.unwrap_or(default).clamp(1_000, maximum)
}

fn home_directory() -> Option<PathBuf> {
    dirs::home_dir()
}

fn credential_provider(name: &str) -> Option<&'static str> {
    match name.to_ascii_uppercase().as_str() {
        "OPENAI_API_KEY" => Some("openai"),
        "ANTHROPIC_API_KEY" => Some("anthropic"),
        "GOOGLE_GENERATIVE_AI_API_KEY" | "GEMINI_API_KEY" | "GOOGLE_API_KEY" => Some("google"),
        "OPENROUTER_API_KEY" => Some("openrouter"),
        "OMNIROUTE_API_KEY" => Some("omniroute"),
        "OPENCODE_API_KEY" => Some("opencode"),
        "VERCEL_AI_GATEWAY_API_KEY" | "AI_GATEWAY_API_KEY" => Some("vercel"),
        "GROQ_API_KEY" => Some("groq"),
        "XAI_API_KEY" => Some("xai"),
        "MISTRAL_API_KEY" => Some("mistral"),
        "COHERE_API_KEY" => Some("cohere"),
        "DEEPSEEK_API_KEY" => Some("deepseek"),
        "TOGETHER_API_KEY" => Some("togetherai"),
        "FIREWORKS_API_KEY" => Some("fireworks"),
        "CEREBRAS_API_KEY" => Some("cerebras"),
        "AWS_ACCESS_KEY_ID" | "AWS_PROFILE" => Some("amazon-bedrock"),
        "AZURE_OPENAI_API_KEY" => Some("azure"),
        "GITHUB_TOKEN" | "GH_TOKEN" => Some("github"),
        "VERCEL_TOKEN" => Some("vercel-deploy"),
        "NETLIFY_AUTH_TOKEN" => Some("netlify"),
        "CLOUDFLARE_API_TOKEN" | "CLOUDFLARE_API_KEY" => Some("cloudflare"),
        "RENDER_API_KEY" => Some("render"),
        "RAILWAY_TOKEN" | "RAILWAY_API_TOKEN" => Some("railway"),
        "FLY_API_TOKEN" => Some("fly"),
        _ => None,
    }
}

fn parse_quoted_dotenv_value(raw: &str, quote: char) -> Option<String> {
    let body_start = quote.len_utf8();
    let mut value = String::new();
    let mut escaped = false;
    for (offset, character) in raw[body_start..].char_indices() {
        let absolute = body_start + offset;
        if quote == '"' && escaped {
            if matches!(character, '"' | '\\') {
                value.push(character);
            } else {
                value.push('\\');
                value.push(character);
            }
            escaped = false;
            continue;
        }
        if quote == '"' && character == '\\' {
            escaped = true;
            continue;
        }
        if character == quote {
            let remainder = raw[absolute + character.len_utf8()..].trim();
            if remainder.is_empty() || remainder.starts_with('#') {
                return Some(value);
            }
            return None;
        }
        value.push(character);
    }
    None
}

fn parse_dotenv_value(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let first = raw.chars().next()?;
    let value = if matches!(first, '\'' | '"') {
        parse_quoted_dotenv_value(raw, first)?
    } else {
        let mut comment_at = None;
        let mut previous_was_whitespace = false;
        for (offset, character) in raw.char_indices() {
            if character == '#' && (offset == 0 || previous_was_whitespace) {
                comment_at = Some(offset);
                break;
            }
            previous_was_whitespace = character.is_whitespace();
        }
        raw[..comment_at.unwrap_or(raw.len())]
            .trim_end()
            .to_string()
    };
    if value.is_empty()
        || value.len() > MAX_DOTENV_VALUE_BYTES
        || value.chars().any(char::is_control)
    {
        return None;
    }
    Some(value)
}

fn parse_env_names(path: &Path, source: &str, entries: &mut Vec<CredentialPresence>) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_DOTENV_FILE_BYTES
    {
        return;
    }
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    for line in content.lines() {
        let line = line.trim().strip_prefix("export ").unwrap_or(line.trim());
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        let name = name.trim();
        if parse_dotenv_value(value).is_none() {
            continue;
        }
        if let Some(provider) = credential_provider(name) {
            entries.push(CredentialPresence {
                provider: provider.to_string(),
                name: name.to_string(),
                source: source.to_string(),
            });
        }
    }
}

fn concise_process_detail(detail: &str, fallback: &str) -> String {
    let detail = detail.trim();
    if detail.is_empty() {
        return fallback.to_string();
    }
    detail.chars().take(300).collect()
}

async fn fetch_local_json(endpoint: &str, timeout_ms: u64) -> (Option<Value>, String) {
    let timeout_seconds = timeout_ms.div_ceil(1_000).clamp(1, 15);
    let script = format!(
        "$ProgressPreference = 'SilentlyContinue'; try {{ Invoke-RestMethod -Method Get -Uri {} -TimeoutSec {timeout_seconds} | ConvertTo-Json -Compress -Depth 10 }} catch {{ [Console]::Error.WriteLine($_.Exception.Message); exit 1 }}",
        ps_quote(endpoint)
    );
    let shell = preferred_powershell();
    match quick_capture(&shell, &powershell_args(script, false), None, timeout_ms).await {
        Ok((stdout, _stderr, true)) => {
            match serde_json::from_str::<Value>(strip_ansi(&stdout).trim()) {
                Ok(value) => (Some(value), "Local API is ready".to_string()),
                Err(error) => (None, format!("Local API returned invalid JSON: {error}")),
            }
        }
        Ok((_, stderr, false)) => (
            None,
            concise_process_detail(&stderr, "Local API is not responding"),
        ),
        Err(error) => (None, error),
    }
}

#[tauri::command]
pub async fn discover_environment(
    state: State<'_, BackendState>,
) -> Result<EnvironmentReport, String> {
    let root = super::workspace::optional_selected_workspace_path(state.inner())?
        .ok_or_else(|| "No workspace is selected".to_string())?;
    let shell = preferred_powershell();
    let script = "[PSCustomObject]@{ windowsVersion = [Environment]::OSVersion.VersionString; powershellVersion = $PSVersionTable.PSVersion.ToString(); tools = [PSCustomObject]@{ git = if (Get-Command git -ErrorAction SilentlyContinue) { (git --version).Trim() } else { $null }; node = if (Get-Command node -ErrorAction SilentlyContinue) { (node --version).Trim() } else { $null }; npm = if (Get-Command npm -ErrorAction SilentlyContinue) { (npm --version).Trim() } else { $null }; rustc = if (Get-Command rustc -ErrorAction SilentlyContinue) { (rustc --version).Trim() } else { $null }; cargo = if (Get-Command cargo -ErrorAction SilentlyContinue) { (cargo --version).Trim() } else { $null }; docker = if (Get-Command docker -ErrorAction SilentlyContinue) { (docker --version).Trim() } else { $null } } } | ConvertTo-Json".to_string();
    let (stdout, stderr, success) =
        quick_capture(&shell, &powershell_args(script, false), Some(&root), 20_000).await?;
    if !success || stdout.trim().is_empty() {
        return Err(format!(
            "Environment discovery failed{}",
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", stderr.trim())
            }
        ));
    }
    let raw: RawEnvironmentReport = serde_json::from_str(stdout.trim())
        .map_err(|error| format!("Cannot parse environment discovery result: {error}"))?;

    Ok(EnvironmentReport {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        family: std::env::consts::FAMILY.to_string(),
        windows_version: raw.windows_version,
        powershell_version: raw.powershell_version,
        home_directory: home_directory().map(|path| path.to_string_lossy().into_owned()),
        temp_directory: std::env::temp_dir().to_string_lossy().into_owned(),
        logical_cpus: std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1),
        preferred_shell: shell,
        tools: raw.tools,
    })
}

#[tauri::command]
pub fn discover_credential_names(
    state: State<'_, BackendState>,
) -> Result<CredentialReport, String> {
    let mut entries = Vec::new();
    let mut scanned_sources = vec!["processEnvironment".to_string()];

    for (name, value) in std::env::vars_os() {
        if value.is_empty() {
            continue;
        }
        let name = name.to_string_lossy();
        if let Some(provider) = credential_provider(&name) {
            entries.push(CredentialPresence {
                provider: provider.to_string(),
                name: name.into_owned(),
                source: "processEnvironment".to_string(),
            });
        }
    }

    if let Ok(Some(workspace)) = super::workspace::optional_selected_workspace_path(state.inner()) {
        for file_name in [".env", ".env.local", ".env.development", ".env.production"] {
            let path = workspace.join(file_name);
            parse_env_names(&path, &format!("workspace:{file_name}"), &mut entries);
            if path.is_file() {
                scanned_sources.push(format!("workspace:{file_name}"));
            }
        }
    }

    let mut seen = BTreeSet::new();
    entries.retain(|entry| {
        seen.insert((
            entry.provider.clone(),
            entry.name.clone(),
            entry.source.clone(),
        ))
    });
    entries.sort_by(|left, right| {
        left.provider
            .cmp(&right.provider)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.source.cmp(&right.source))
    });

    Ok(CredentialReport {
        entries,
        scanned_sources,
    })
}

#[tauri::command]
pub async fn discover_local_ai_providers(
    state: State<'_, BackendState>,
    request: LocalProvidersRequest,
) -> Result<LocalProvidersResult, String> {
    let selected = super::workspace::optional_selected_workspace_path(state.inner())?;
    let timeout_ms = clamp_timeout(request.timeout_ms, 2_500, 15_000);
    let ollama_tool = resolve_tool("ollama", selected.as_deref())
        .await
        .unwrap_or_else(|_| unavailable_tool("ollama"));
    let lm_studio_tool = resolve_tool("lms", selected.as_deref())
        .await
        .unwrap_or_else(|_| unavailable_tool("lms"));
    let omniroute_tool = resolve_tool("omniroute", selected.as_deref())
        .await
        .unwrap_or_else(|_| unavailable_tool("omniroute"));
    let ollama_available = ollama_tool.available;
    let _ollama_cli_path = if ollama_available {
        ollama_tool.path.clone()
    } else {
        None
    };
    let lm_studio_available = lm_studio_tool.available;
    let _lm_studio_cli_path = if lm_studio_available {
        lm_studio_tool.path.clone()
    } else {
        None
    };

    let configured_ollama_host = std::env::var("OLLAMA_HOST").ok();
    let valid_ollama_host = configured_ollama_host
        .as_deref()
        .and_then(normalized_loopback_url);
    let invalid_ollama_host = configured_ollama_host.is_some() && valid_ollama_host.is_none();
    let ollama_base = valid_ollama_host.unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    let ollama_endpoint = format!("{}/api/tags", ollama_base.trim_end_matches('/'));
    let (ollama_json, mut ollama_detail) = fetch_local_json(&ollama_endpoint, timeout_ms).await;
    if invalid_ollama_host {
        ollama_detail.push_str("; ignored non-loopback OLLAMA_HOST for safety");
    }
    let mut ollama_models = ollama_json
        .as_ref()
        .and_then(|value| value.get("models"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model
                .get("name")
                .or_else(|| model.get("model"))
                .and_then(Value::as_str)?;
            if id.trim().is_empty() {
                return None;
            }
            Some(LocalModel {
                id: id.to_string(),
                name: id.to_string(),
            })
        })
        .collect::<Vec<_>>();
    ollama_models.sort_by(|left, right| left.id.cmp(&right.id));
    ollama_models.dedup_by(|left, right| left.id == right.id);
    let ollama_reachable = ollama_json.is_some();

    let lm_studio_endpoint = "http://127.0.0.1:1234/v1/models".to_string();
    let (lm_studio_json, lm_studio_detail) =
        fetch_local_json(&lm_studio_endpoint, timeout_ms).await;
    let mut lm_studio_models = lm_studio_json
        .as_ref()
        .and_then(|value| value.get("data"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model.get("id").and_then(Value::as_str)?;
            if id.trim().is_empty() {
                return None;
            }
            Some(LocalModel {
                id: id.to_string(),
                name: id.to_string(),
            })
        })
        .collect::<Vec<_>>();
    lm_studio_models.sort_by(|left, right| left.id.cmp(&right.id));
    lm_studio_models.dedup_by(|left, right| left.id == right.id);
    let lm_studio_reachable = lm_studio_json.is_some();

    let omniroute_endpoint = "http://127.0.0.1:20128/v1/models".to_string();
    let (omniroute_json, omniroute_detail) =
        fetch_local_json(&omniroute_endpoint, timeout_ms).await;
    let mut omniroute_models = omniroute_json
        .as_ref()
        .and_then(|value| value.get("data"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model.get("id").and_then(Value::as_str)?;
            (!id.trim().is_empty()).then(|| LocalModel {
                id: id.to_string(),
                name: id.to_string(),
            })
        })
        .collect::<Vec<_>>();
    omniroute_models.sort_by(|left, right| left.id.cmp(&right.id));
    omniroute_models.dedup_by(|left, right| left.id == right.id);
    let omniroute_reachable = omniroute_json.is_some();

    Ok(LocalProvidersResult {
        providers: vec![
            LocalProviderStatus {
                id: "ollama".to_string(),
                name: "Ollama".to_string(),
                detected: ollama_available || ollama_reachable,
                reachable: ollama_reachable,
                endpoint: ollama_endpoint,
                cli_path: if ollama_tool.available {
                    ollama_tool.path
                } else {
                    None
                },
                models: ollama_models,
                detail: ollama_detail,
            },
            LocalProviderStatus {
                id: "lmstudio".to_string(),
                name: "LM Studio".to_string(),
                detected: lm_studio_available || lm_studio_reachable,
                reachable: lm_studio_reachable,
                endpoint: lm_studio_endpoint,
                cli_path: if lm_studio_tool.available {
                    lm_studio_tool.path
                } else {
                    None
                },
                models: lm_studio_models,
                detail: lm_studio_detail,
            },
            LocalProviderStatus {
                id: "omniroute".to_string(),
                name: "OmniRoute".to_string(),
                detected: omniroute_tool.available || omniroute_reachable,
                reachable: omniroute_reachable,
                endpoint: omniroute_endpoint,
                cli_path: if omniroute_tool.available {
                    omniroute_tool.path
                } else {
                    None
                },
                models: omniroute_models,
                detail: omniroute_detail,
            },
        ],
    })
}

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::{
    process::Command,
    time::{timeout, Duration},
};

const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_SCAN_DEPTH: usize = 7;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexPlugin {
    pub plugin_id: String,
    pub id: String,
    pub marketplace_name: String,
    pub installed: bool,
    pub enabled: bool,
    pub display_name: String,
    pub description: String,
    pub version: String,
    pub developer_name: String,
    pub category: Option<String>,
    pub capabilities: Vec<String>,
    pub brand_color: Option<String>,
    pub website_url: Option<String>,
    pub manifest_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginCatalog {
    pub installed: Vec<CodexPlugin>,
    pub available: Vec<CodexPlugin>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliPluginCatalog {
    installed: Vec<CliPlugin>,
    available: Vec<CliPlugin>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliPlugin {
    plugin_id: String,
    name: String,
    marketplace_name: String,
    version: Option<String>,
    installed: bool,
    enabled: bool,
    source: CliPluginSource,
}

#[derive(Debug, Deserialize)]
struct CliPluginSource {
    path: Option<String>,
}

fn plugin_root() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".codex").join("plugins").join("cache"))
        .ok_or_else(|| "Could not resolve the current user's home directory".to_string())
}

fn string_at(value: &Value, pointer: &str) -> Option<String> {
    value
        .pointer(pointer)?
        .as_str()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn parse_manifest(path: &Path) -> Result<CodexPlugin, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(format!(
            "Plugin manifest exceeds {} bytes",
            MAX_MANIFEST_BYTES
        ));
    }
    let value: Value = serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?,
    )
    .map_err(|error| format!("Invalid plugin manifest {}: {error}", path.display()))?;
    let id = string_at(&value, "/name")
        .ok_or_else(|| format!("Plugin manifest {} has no name", path.display()))?;
    let capabilities = value
        .pointer("/interface/capabilities")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Ok(CodexPlugin {
        plugin_id: id.clone(),
        marketplace_name: String::new(),
        installed: true,
        enabled: true,
        display_name: string_at(&value, "/interface/displayName").unwrap_or_else(|| id.clone()),
        description: string_at(&value, "/interface/shortDescription")
            .or_else(|| string_at(&value, "/description"))
            .unwrap_or_default(),
        version: string_at(&value, "/version").unwrap_or_else(|| "unknown".into()),
        developer_name: string_at(&value, "/interface/developerName")
            .or_else(|| string_at(&value, "/author/name"))
            .unwrap_or_else(|| "Unknown developer".into()),
        category: string_at(&value, "/interface/category"),
        capabilities,
        brand_color: string_at(&value, "/interface/brandColor"),
        website_url: string_at(&value, "/interface/websiteURL")
            .or_else(|| string_at(&value, "/homepage")),
        manifest_path: path.to_string_lossy().into_owned(),
        id,
    })
}

fn display_name(name: &str) -> String {
    name.split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn from_cli(plugin: CliPlugin) -> CodexPlugin {
    let manifest_path = plugin
        .source
        .path
        .as_deref()
        .map(Path::new)
        .map(|path| path.join(".codex-plugin").join("plugin.json"));
    let mut item = manifest_path
        .as_deref()
        .filter(|path| path.is_file())
        .and_then(|path| parse_manifest(path).ok())
        .unwrap_or_else(|| CodexPlugin {
            plugin_id: plugin.plugin_id.clone(),
            id: plugin.name.clone(),
            marketplace_name: plugin.marketplace_name.clone(),
            installed: plugin.installed,
            enabled: plugin.enabled,
            display_name: display_name(&plugin.name),
            description: String::new(),
            version: plugin.version.clone().unwrap_or_else(|| "unknown".into()),
            developer_name: plugin.marketplace_name.clone(),
            category: None,
            capabilities: Vec::new(),
            brand_color: None,
            website_url: None,
            manifest_path: manifest_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_default(),
        });
    item.plugin_id = plugin.plugin_id;
    item.id = plugin.name;
    item.marketplace_name = plugin.marketplace_name;
    item.installed = plugin.installed;
    item.enabled = plugin.enabled;
    if let Some(version) = plugin.version {
        item.version = version;
    }
    item
}

async fn codex_output(args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = Command::new("codex");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::backend::execution::hide_console(&mut command);
    timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| "Codex plugin command timed out".to_string())?
        .map_err(|error| format!("Cannot run Codex plugin command: {error}"))
}

fn validate_plugin_selector(plugin_id: &str) -> Result<(), String> {
    let mut parts = plugin_id.split('@');
    let valid = |part: &str| {
        !part.is_empty()
            && part.len() <= 100
            && part
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };
    match (parts.next(), parts.next(), parts.next()) {
        (Some(plugin), Some(marketplace), None) if valid(plugin) && valid(marketplace) => Ok(()),
        _ => Err("Plugin selector must use plugin@marketplace with lowercase letters, numbers, and hyphens".into()),
    }
}

fn discover_from(root: &Path) -> Result<Vec<CodexPlugin>, String> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut plugins = Vec::new();
    while let Some((directory, depth)) = queue.pop_front() {
        if depth > MAX_SCAN_DEPTH {
            continue;
        }
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().and_then(|name| name.to_str()) == Some(".codex-plugin") {
                    let manifest = path.join("plugin.json");
                    if manifest.is_file() {
                        if let Ok(plugin) = parse_manifest(&manifest) {
                            plugins.push(plugin);
                        }
                    }
                } else {
                    queue.push_back((path, depth + 1));
                }
            }
        }
    }
    plugins.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
            .then_with(|| a.version.cmp(&b.version))
    });
    plugins.dedup_by(|a, b| a.id == b.id && a.version == b.version);
    Ok(plugins)
}

#[tauri::command]
pub async fn list_codex_plugins() -> Result<Vec<CodexPlugin>, String> {
    match list_codex_plugin_catalog().await {
        Ok(catalog) => Ok(catalog.installed),
        Err(_) => discover_from(&plugin_root()?),
    }
}

#[tauri::command]
pub async fn list_codex_plugin_catalog() -> Result<CodexPluginCatalog, String> {
    let output = codex_output(&["plugin", "list", "--available", "--json"]).await?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    if output.stdout.len() > 8 * 1024 * 1024 {
        return Err("Codex plugin catalog is unexpectedly large".into());
    }
    let catalog: CliPluginCatalog = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Codex returned invalid plugin catalog data: {error}"))?;
    let mut installed: Vec<CodexPlugin> = catalog.installed.into_iter().map(from_cli).collect();
    if let Ok(discovered) = discover_from(&plugin_root()?) {
        for plugin in discovered {
            if !installed.iter().any(|candidate| candidate.id == plugin.id) {
                installed.push(plugin);
            }
        }
    }
    installed.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    let installed_ids: std::collections::HashSet<&str> =
        installed.iter().map(|plugin| plugin.id.as_str()).collect();
    let available = catalog
        .available
        .into_iter()
        .map(from_cli)
        .filter(|plugin| !installed_ids.contains(plugin.id.as_str()))
        .collect();
    Ok(CodexPluginCatalog {
        installed,
        available,
    })
}

#[tauri::command]
pub async fn install_codex_plugin(plugin_id: String) -> Result<(), String> {
    validate_plugin_selector(&plugin_id)?;
    let output = codex_output(&["plugin", "add", &plugin_id, "--json"]).await?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn remove_codex_plugin(plugin_id: String) -> Result<(), String> {
    validate_plugin_selector(&plugin_id)?;
    let output = codex_output(&["plugin", "remove", &plugin_id, "--json"]).await?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_manifest_shape() {
        let root = std::env::temp_dir().join(format!("whim-plugin-test-{}", uuid::Uuid::new_v4()));
        let manifest_dir = root
            .join("openai")
            .join("sites")
            .join("1.0")
            .join(".codex-plugin");
        fs::create_dir_all(&manifest_dir).unwrap();
        fs::write(manifest_dir.join("plugin.json"), r##"{
          "name":"sites","version":"1.0.0","description":"fallback",
          "author":{"name":"OpenAI"},
          "interface":{"displayName":"Sites","shortDescription":"Build websites","category":"Productivity","capabilities":["Interactive","Write"],"brandColor":"#0C79D8"}
        }"##).unwrap();
        let plugins = discover_from(&root).unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].id, "sites");
        assert_eq!(plugins[0].display_name, "Sites");
        assert_eq!(plugins[0].capabilities, vec!["Interactive", "Write"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validates_cli_plugin_selectors() {
        assert!(validate_plugin_selector("sites@openai-bundled").is_ok());
        assert!(validate_plugin_selector("sites").is_err());
        assert!(validate_plugin_selector("sites@openai-bundled --json").is_err());
    }
}

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub repository: String,
}

fn get_plugins_dir() -> PathBuf {
    let mut path = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push(".whim");
    path.push("plugins");
    path
}

#[command]
pub async fn fetch_available_plugins() -> Result<Vec<AgentPlugin>, String> {
    // In a real app, this would fetch from GitHub (e.g. openai/skills, anthropics/skills)
    // For now, return a mock list of available plugins.
    let available = vec![
        AgentPlugin {
            id: "openai-browser-skill".to_string(),
            name: "OpenAI Browser Skill".to_string(),
            description: "Allows the agent to browse the web.".to_string(),
            version: "1.0.0".to_string(),
            author: "openai".to_string(),
            repository: "https://github.com/openai/skills".to_string(),
        },
        AgentPlugin {
            id: "anthropic-mcp-github".to_string(),
            name: "Claude GitHub MCP".to_string(),
            description: "Connects Claude to GitHub repositories.".to_string(),
            version: "0.5.0".to_string(),
            author: "anthropics".to_string(),
            repository: "https://github.com/anthropics/skills".to_string(),
        },
    ];
    Ok(available)
}

#[command]
pub async fn get_installed_plugins() -> Result<Vec<AgentPlugin>, String> {
    let plugins_dir = get_plugins_dir();
    if !plugins_dir.exists() {
        return Ok(Vec::new());
    }

    let mut installed = Vec::new();
    if let Ok(entries) = fs::read_dir(plugins_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("manifest.json");
                if let Ok(content) = fs::read_to_string(manifest_path) {
                    if let Ok(plugin) = serde_json::from_str::<AgentPlugin>(&content) {
                        installed.push(plugin);
                    }
                }
            }
        }
    }
    
    Ok(installed)
}

#[command]
pub async fn install_plugin(plugin_id: String) -> Result<bool, String> {
    let plugins_dir = get_plugins_dir();
    let target_dir = plugins_dir.join(&plugin_id);
    
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    // Mock installation - just write a manifest file
    let manifest = AgentPlugin {
        id: plugin_id.clone(),
        name: format!("Installed {}", plugin_id),
        description: "Mock installed plugin".to_string(),
        version: "1.0.0".to_string(),
        author: "System".to_string(),
        repository: "".to_string(),
    };

    let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    fs::write(target_dir.join("manifest.json"), manifest_json).map_err(|e| e.to_string())?;

    Ok(true)
}

use super::client::{McpClient, McpServerKind};
use super::types::{Tool, ToolCallResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerEntry {
    #[serde(rename = "type")]
    pub server_type: String,
    pub url: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

impl McpServerEntry {
    pub fn is_enabled(&self) -> bool {
        self.enabled.unwrap_or(true)
    }
}

pub struct McpManager {
    servers: Mutex<HashMap<String, Arc<McpClient>>>,
}

impl McpManager {
    pub fn new() -> Arc<Self> {
        Arc::new(McpManager {
            servers: Mutex::new(HashMap::new()),
        })
    }

    pub async fn connect_all(self: &Arc<Self>, config: &HashMap<String, McpServerEntry>) -> Result<Vec<String>, String> {
        let mut servers = self.servers.lock().await;
        let mut connected = Vec::new();

        for (id, entry) in config {
            if !entry.is_enabled() {
                continue;
            }
            if servers.contains_key(id) {
                continue;
            }

            let kind = if entry.server_type == "stdio" {
                let command = entry.command.as_ref()
                    .ok_or_else(|| format!("MCP server '{id}': 'command' is required for stdio type"))?;
                McpServerKind::Stdio {
                    command: command.clone(),
                    args: entry.args.clone().unwrap_or_default(),
                }
            } else {
                let url = entry.url.as_ref()
                    .ok_or_else(|| format!("MCP server '{id}': 'url' is required for remote type"))?;
                McpServerKind::Sse {
                    url: url.clone(),
                }
            };

            match McpClient::connect(kind).await {
                Ok(client) => {
                    servers.insert(id.clone(), client);
                    connected.push(id.clone());
                }
                Err(e) => {
                    eprintln!("WHIM: failed to connect MCP server '{id}': {e}");
                }
            }
        }

        Ok(connected)
    }

    pub async fn disconnect_all(self: &Arc<Self>) -> Result<(), String> {
        let mut servers = self.servers.lock().await;
        for (_, client) in servers.drain() {
            let _ = client.close().await;
        }
        Ok(())
    }

    pub async fn list_all_tools(self: &Arc<Self>) -> Vec<McpToolDescriptor> {
        let servers = self.servers.lock().await;
        let mut tools = Vec::new();
        for (server_id, client) in servers.iter() {
            match client.list_tools().await {
                Ok(server_tools) => {
                    for tool in server_tools {
                        tools.push(McpToolDescriptor {
                            server_id: server_id.clone(),
                            tool: tool.clone(),
                            qualified_name: format!("mcp__{server_id}__{}", tool.name),
                        });
                    }
                }
                Err(e) => {
                    eprintln!("WHIM: failed to list tools from MCP server '{server_id}': {e}");
                }
            }
        }
        tools
    }

    pub async fn reconnect_all(self: &Arc<Self>, config: &HashMap<String, McpServerEntry>) -> Result<Vec<String>, String> {
        self.disconnect_all().await?;
        self.connect_all(config).await
    }

    pub async fn call_tool(self: &Arc<Self>, qualified_name: &str, arguments: Value) -> Result<ToolCallResult, String> {
        let (server_id, tool_name) = parse_mcp_tool_name(qualified_name)
            .ok_or_else(|| format!("Invalid MCP tool name: '{qualified_name}'"))?;

        let servers = self.servers.lock().await;
        let client = servers.get(&server_id)
            .ok_or_else(|| format!("MCP server '{server_id}' is not connected"))?;

        client.call_tool(&tool_name, arguments).await
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    pub server_id: String,
    pub tool: Tool,
    pub qualified_name: String,
}

pub fn parse_mcp_tool_name(qualified_name: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = qualified_name.splitn(3, "__").collect();
    if parts.len() == 3 && parts[0] == "mcp" {
        Some((parts[1].to_string(), parts[2].to_string()))
    } else {
        None
    }
}

pub fn is_mcp_tool(qualified_name: &str) -> bool {
    qualified_name.starts_with("mcp__")
}

#[tauri::command]
pub async fn mcp_reload(
    state: tauri::State<'_, crate::backend::BackendState>,
    workspace: String,
) -> Result<Vec<String>, String> {
    let root = crate::backend::workspace::resolve_agent_workspace(state.inner(), Some(&workspace)).await?;
    let config = read_mcp_config(&root)?;
    let connected = state.inner().mcp_manager.reconnect_all(&config).await?;
    Ok(connected)
}

pub(crate) async fn mcp_sync_tools(
    state: &crate::backend::BackendState,
    workspace_root: &Path,
) -> Result<(), String> {
    let config = read_mcp_config(workspace_root)?;
    if !config.is_empty() {
        state.mcp_manager.reconnect_all(&config).await?;
    }
    Ok(())
}

pub fn read_mcp_config(root: &Path) -> Result<HashMap<String, McpServerEntry>, String> {
    let config_path = root.join(".whim").join("config.json");
    if !config_path.exists() {
        return Ok(HashMap::new());
    }
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read .whim/config.json: {e}"))?;
    let parsed: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse .whim/config.json: {e}"))?;
    let mcp = parsed
        .get("ecosystem")
        .and_then(|e| e.get("mcp"))
        .and_then(|m| m.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(id, val)| {
                    let entry: McpServerEntry = serde_json::from_value(val.clone()).ok()?;
                    Some((id.clone(), entry))
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    Ok(mcp)
}

use super::transport::{McpTransport, SseTransport, StdioTransport};
use super::types::{
    self, CallToolRequest, ClientCapabilities, Implementation, InitializeRequest, InitializeResult,
    JsonRpcId, JsonRpcMessage, ListToolsResult, Tool, ToolCallResult,
};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

pub enum McpServerKind {
    Stdio {
        command: String,
        args: Vec<String>,
    },
    Sse {
        url: String,
    },
}

pub struct McpClient {
    transport: Arc<dyn McpTransport>,
    next_id: AtomicU64,
    server_info: Mutex<Option<InitializeResult>>,
}

impl McpClient {
    pub async fn connect(kind: McpServerKind) -> Result<Arc<Self>, String> {
        let transport: Arc<dyn McpTransport> = match kind {
            McpServerKind::Stdio { command, args } => {
                let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
                Arc::new(StdioTransport::spawn(&command, &args_refs).await?)
            }
            McpServerKind::Sse { url } => {
                let transport = SseTransport::new(&url);
                transport.connect().await?;
                Arc::new(transport) as Arc<dyn McpTransport>
            }
        };

        let client = Arc::new(McpClient {
            transport,
            next_id: AtomicU64::new(1),
            server_info: Mutex::new(None),
        });

        client.initialize().await?;

        Ok(client)
    }

    async fn initialize(self: &Arc<Self>) -> Result<(), String> {
        let request = types::jsonrpc_request(
            self.next_id(),
            "initialize",
            Some(serde_json::to_value(InitializeRequest {
                protocol_version: types::PROTOCOL_VERSION.to_string(),
                capabilities: ClientCapabilities {
                    roots: None,
                    sampling: None,
                },
                client_info: Implementation {
                    name: "whim-ide".to_string(),
                    version: "0.5.0".to_string(),
                },
            }).map_err(|e| format!("Serialize error: {e}"))?),
        );

        self.transport.send(&request).await?;

        match self.transport.receive().await? {
            JsonRpcMessage::Response(resp) => {
                let result: InitializeResult = serde_json::from_value(resp.result)
                    .map_err(|e| format!("Failed to parse initialize result: {e}"))?;
                *self.server_info.lock().await = Some(result);
            }
            JsonRpcMessage::Error(err) => {
                return Err(format!("MCP initialize error [{}]: {}", err.error.code, err.error.message));
            }
            _ => return Err("Unexpected response type during MCP initialize".to_string()),
        }

        let notified = types::jsonrpc_notification("notifications/initialized", None);
        self.transport.send(&notified).await?;

        Ok(())
    }

    pub async fn list_tools(self: &Arc<Self>) -> Result<Vec<Tool>, String> {
        let request = types::jsonrpc_request(self.next_id(), "tools/list", None);
        self.transport.send(&request).await?;

        match self.transport.receive().await? {
            JsonRpcMessage::Response(resp) => {
                let result: ListToolsResult = serde_json::from_value(resp.result)
                    .map_err(|e| format!("Failed to parse tools/list result: {e}"))?;
                Ok(result.tools)
            }
            JsonRpcMessage::Error(err) => {
                Err(format!("MCP tools/list error [{}]: {}", err.error.code, err.error.message))
            }
            _ => Err("Unexpected response type during tools/list".to_string()),
        }
    }

    pub async fn call_tool(self: &Arc<Self>, name: &str, arguments: Value) -> Result<ToolCallResult, String> {
        let params = CallToolRequest {
            name: name.to_string(),
            arguments,
        };
        let request = types::jsonrpc_request(
            self.next_id(),
            "tools/call",
            Some(serde_json::to_value(params)
                .map_err(|e| format!("Serialize error: {e}"))?),
        );

        self.transport.send(&request).await?;

        match self.transport.receive().await? {
            JsonRpcMessage::Response(resp) => {
                serde_json::from_value(resp.result)
                    .map_err(|e| format!("Failed to parse tools/call result: {e}"))
            }
            JsonRpcMessage::Error(err) => {
                Err(format!("MCP tools/call error [{}]: {}", err.error.code, err.error.message))
            }
            _ => Err("Unexpected response type during tools/call".to_string()),
        }
    }

    pub async fn close(self: &Arc<Self>) -> Result<(), String> {
        self.transport.close().await
    }

    fn next_id(&self) -> JsonRpcId {
        JsonRpcId::Number(self.next_id.fetch_add(1, Ordering::SeqCst))
    }
}

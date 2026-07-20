use super::types::JsonRpcMessage;
use async_trait::async_trait;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

#[async_trait]
pub trait McpTransport: Send + Sync {
    async fn send(&self, message: &JsonRpcMessage) -> Result<(), String>;
    async fn receive(&self) -> Result<JsonRpcMessage, String>;
    async fn close(&self) -> Result<(), String>;
}

pub struct StdioTransport {
    stdin: Arc<Mutex<ChildStdin>>,
    stdout: Arc<Mutex<BufReader<ChildStdout>>>,
    child: Arc<Mutex<Option<Child>>>,
}

impl StdioTransport {
    pub async fn spawn(command: &str, args: &[&str]) -> Result<Self, String> {
        let mut child = tokio::process::Command::new(command)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to spawn MCP server '{command}': {e}"))?;

        let stdin = child.stdin.take()
            .ok_or_else(|| "Failed to open stdin for MCP server".to_string())?;
        let stdout = child.stdout.take()
            .ok_or_else(|| "Failed to open stdout for MCP server".to_string())?;

        Ok(StdioTransport {
            stdin: Arc::new(Mutex::new(stdin)),
            stdout: Arc::new(Mutex::new(BufReader::new(stdout))),
            child: Arc::new(Mutex::new(Some(child))),
        })
    }
}

#[async_trait]
impl McpTransport for StdioTransport {
    async fn send(&self, message: &JsonRpcMessage) -> Result<(), String> {
        let json = serde_json::to_string(message)
            .map_err(|e| format!("Failed to serialize MCP message: {e}"))?;
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(json.as_bytes()).await
            .map_err(|e| format!("Failed to write to MCP server stdin: {e}"))?;
        stdin.write_all(b"\n").await
            .map_err(|e| format!("Failed to write newline to MCP server stdin: {e}"))?;
        stdin.flush().await
            .map_err(|e| format!("Failed to flush MCP server stdin: {e}"))?;
        Ok(())
    }

    async fn receive(&self) -> Result<JsonRpcMessage, String> {
        let mut stdout = self.stdout.lock().await;
        let mut line = String::new();
        stdout.read_line(&mut line).await
            .map_err(|e| format!("Failed to read from MCP server stdout: {e}"))?;
        if line.is_empty() {
            return Err("MCP server closed connection".to_string());
        }
        serde_json::from_str(&line)
            .map_err(|e| format!("Failed to parse MCP message: {e}"))
    }

    async fn close(&self) -> Result<(), String> {
        let mut child_opt = self.child.lock().await;
        if let Some(mut child) = child_opt.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        Ok(())
    }
}

pub struct SseTransport {
    base_url: String,
    client: reqwest::Client,
    session_id: Arc<Mutex<Option<String>>>,
}

impl SseTransport {
    pub fn new(base_url: &str) -> Self {
        SseTransport {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: reqwest::Client::new(),
            session_id: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn connect(&self) -> Result<(), String> {
        let response = self.client.get(&self.base_url)
            .header("Accept", "text/event-stream")
            .send()
            .await
            .map_err(|e| format!("Failed to connect to MCP SSE endpoint: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("MCP SSE connection failed with status: {}", response.status()));
        }

        Ok(())
    }
}

#[async_trait]
impl McpTransport for SseTransport {
    async fn send(&self, message: &JsonRpcMessage) -> Result<(), String> {
        let json = serde_json::to_string(message)
            .map_err(|e| format!("Failed to serialize MCP message: {e}"))?;

        let mut url = self.base_url.clone();
        let session_id = self.session_id.lock().await;
        if let Some(sid) = session_id.as_ref() {
            url = format!("{}/message?sessionId={sid}", self.base_url);
        }

        let response = self.client.post(&url)
            .header("Content-Type", "application/json")
            .body(json)
            .send()
            .await
            .map_err(|e| format!("Failed to send MCP message: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("MCP POST failed with status: {}", response.status()));
        }

        Ok(())
    }

    async fn receive(&self) -> Result<JsonRpcMessage, String> {
        Err("SSE transport does not support receive() directly; use SseEventStream".to_string())
    }

    async fn close(&self) -> Result<(), String> {
        Ok(())
    }
}

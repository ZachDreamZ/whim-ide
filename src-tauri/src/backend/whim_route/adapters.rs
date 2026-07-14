use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    pub supports_streaming: bool,
    pub supports_tools: bool,
    pub supports_vision: bool,
    pub supports_audio: bool,
    pub supports_structured_output: bool,
    pub supports_reasoning_control: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub provider_id: String,
    pub model_id: String,
    pub display_name: String,
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
    pub capabilities: ModelCapabilities,
    pub input_cost_per_million: Option<f64>,
    pub output_cost_per_million: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedModelRequest {
    pub task_type: String,
    pub goal_id: String,
    pub agent_id: String,
    pub messages: Vec<UnifiedMessage>,
    pub required_capabilities: Vec<String>,
    pub preferred_models: Vec<String>,
    pub excluded_models: Vec<String>,
    pub maximum_cost: Option<f64>,
    pub latency_preference: String,
    pub privacy_policy: Option<String>,
    pub fallback_allowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedModelEvent {
    pub delta: Option<String>,
    pub event_type: String, // "content", "tool_call", "finish"
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostEstimate {
    pub input_cost: f64,
    pub output_cost_estimate: f64,
}

#[async_trait::async_trait]
pub trait ModelProviderAdapter: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;

    async fn test_connection(&self, api_key: &str) -> Result<(), String>;
    async fn list_models(&self, api_key: &str) -> Result<Vec<ModelDescriptor>, String>;
    
    // Future expansion: streaming, cost estimate, and cancellation
    // async fn stream(&self, request: UnifiedModelRequest) -> Result<tokio::sync::mpsc::Receiver<UnifiedModelEvent>, String>;
    // async fn estimate_cost(&self, request: UnifiedModelRequest) -> Result<CostEstimate, String>;
    // async fn cancel(&self, request_id: &str) -> Result<(), String>;
}

pub struct OpenAiAdapter;

#[async_trait::async_trait]
impl ModelProviderAdapter for OpenAiAdapter {
    fn id(&self) -> &str {
        "openai"
    }

    fn display_name(&self) -> &str {
        "OpenAI"
    }

    async fn test_connection(&self, _api_key: &str) -> Result<(), String> {
        // Mock connection test
        Ok(())
    }

    async fn list_models(&self, _api_key: &str) -> Result<Vec<ModelDescriptor>, String> {
        Ok(vec![
            ModelDescriptor {
                provider_id: self.id().to_string(),
                model_id: "gpt-4o".to_string(),
                display_name: "GPT-4o".to_string(),
                context_window: Some(128_000),
                max_output_tokens: Some(4096),
                capabilities: ModelCapabilities {
                    supports_streaming: true,
                    supports_tools: true,
                    supports_vision: true,
                    supports_audio: false,
                    supports_structured_output: true,
                    supports_reasoning_control: false,
                },
                input_cost_per_million: Some(5.0),
                output_cost_per_million: Some(15.0),
            }
        ])
    }
}

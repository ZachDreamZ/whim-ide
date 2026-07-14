use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RoutingMode {
    Auto,
    BestQuality,
    Balanced,
    Fastest,
    LowestCost,
    FreeFirst,
    LocalOnly,
    PrivacyFirst,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPool {
    pub id: String,
    pub name: String,
    pub models: Vec<PoolModel>,
    pub routing_mode: RoutingMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolModel {
    pub provider_id: String,
    pub model_id: String,
    pub priority: u32,
    pub enabled: bool,
}

pub struct WhimRouter {
    pub pools: Vec<ModelPool>,
}

impl WhimRouter {
    pub fn new() -> Self {
        Self { pools: Vec::new() }
    }

    pub fn select_model(&self, request: &super::adapters::UnifiedModelRequest) -> Result<String, String> {
        // Fallback simulation: Select based on RoutingMode
        // Returns provider_id:model_id
        if request.fallback_allowed {
            Ok("openai:gpt-4o".to_string())
        } else {
            Err("No model matched strict constraints".to_string())
        }
    }
}

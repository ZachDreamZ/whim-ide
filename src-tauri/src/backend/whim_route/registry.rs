use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use super::adapters::ModelDescriptor;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    #[serde(flatten)]
    pub descriptor: ModelDescriptor,
    pub health: String,
    pub enabled: bool,
}

#[derive(Clone)]
pub struct ModelRegistry {
    entries: Arc<RwLock<HashMap<String, RegistryEntry>>>,
}

impl ModelRegistry {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn add_models(&self, models: Vec<ModelDescriptor>) {
        let mut write = self.entries.write().await;
        for m in models {
            let key = format!("{}:{}", m.provider_id, m.model_id);
            write.insert(key, RegistryEntry {
                descriptor: m,
                health: "healthy".to_string(),
                enabled: true,
            });
        }
    }

    pub async fn get_all(&self) -> Vec<RegistryEntry> {
        let read = self.entries.read().await;
        read.values().cloned().collect()
    }
}

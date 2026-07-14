use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderCredential {
    pub provider_id: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

#[command]
pub fn save_credential(provider: &str, api_key: &str) -> Result<(), String> {
    let entry = Entry::new("whim-ide-providers", provider)
        .map_err(|e| format!("Failed to access keyring: {}", e))?;
    entry.set_password(api_key).map_err(|e| format!("Failed to save credential: {}", e))
}

#[command]
pub fn get_credential(provider: &str) -> Result<String, String> {
    let entry = Entry::new("whim-ide-providers", provider)
        .map_err(|e| format!("Failed to access keyring: {}", e))?;
    entry.get_password().map_err(|e| format!("Failed to retrieve credential: {}", e))
}

#[command]
pub fn delete_credential(provider: &str) -> Result<(), String> {
    let entry = Entry::new("whim-ide-providers", provider)
        .map_err(|e| format!("Failed to access keyring: {}", e))?;
    entry.delete_credential().map_err(|e| format!("Failed to delete credential: {}", e))
}

#[command]
pub fn redact_key(key: &str) -> String {
    if key.len() <= 8 {
        return "***".to_string();
    }
    let prefix = &key[..8];
    let suffix = &key[key.len() - 4..];
    format!("{}••••••••••••{}", prefix, suffix)
}

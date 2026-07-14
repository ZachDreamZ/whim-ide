use keyring::Entry;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
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
    entry
        .set_password(api_key)
        .map_err(|e| format!("Failed to save credential: {}", e))
}

#[command]
pub fn get_credential(provider: &str) -> Result<String, String> {
    let entry = Entry::new("whim-ide-providers", provider)
        .map_err(|e| format!("Failed to access keyring: {}", e))?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to retrieve credential: {}", e))
}

#[command]
pub fn delete_credential(provider: &str) -> Result<(), String> {
    let entry = Entry::new("whim-ide-providers", provider)
        .map_err(|e| format!("Failed to access keyring: {}", e))?;
    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete credential: {}", e))
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

/// Redacts secrets found inside arbitrary text such as command stdout/stderr
/// before it is returned to the UI or the agent. Only well-known secret
/// shapes are matched (provider key prefixes, private-key PEM blocks, and
/// sensitive `name=value` assignments, `Bearer`/`Basic` auth schemes) so
/// benign output such as build logs or commit hashes is preserved.
pub fn redact_secrets(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let private_key = private_key_block_re().replace_all(text, "[REDACTED PRIVATE KEY]");
    let after_prefixes = secret_prefix_re().replace_all(&private_key, "[REDACTED]");
    let after_assignment = secret_assignment_re().replace_all(&after_prefixes, "$1$2[REDACTED]");
    secret_scheme_re()
        .replace_all(&after_assignment, "$1 [REDACTED]")
        .into_owned()
}

fn private_key_block_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
        )
        .expect("valid private key block regex")
    })
}

fn secret_prefix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)\b(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{10,}|gh[pousr]_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]+|glpat-[0-9A-Za-z_-]{20,}|glrt-[0-9A-Za-z_-]{20,}|npm_[0-9A-Za-z]{36})\b",
        )
        .expect("valid secret prefix regex")
    })
}

fn secret_assignment_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b(\s*[:=]\s*)(\S+)",
        )
        .expect("valid secret assignment regex")
    })
}

fn secret_scheme_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\b(bearer|basic)\s+([A-Za-z0-9._~+/=-]+)")
            .expect("valid secret scheme regex")
    })
}

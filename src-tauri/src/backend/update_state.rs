use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

const MAX_UPDATE_STATE_BYTES: u64 = 64 * 1024;
const ALLOWED_CHANNELS: [&str; 3] = ["stable", "beta", "nightly"];

/// Durable, on-disk update state. Mirrors the atomic write pattern used by
/// `settings.rs` so an interrupted write cannot corrupt the recovery record.
///
/// This is the single source of truth the frontend uses to:
/// * remember the user's channel + auto-check preference,
/// * cache the last successful / last attempted check timestamp,
/// * recover the "an update is available / downloaded" state after the app is
///   closed or relaunched (the in-memory updater download lives in the webview
///   resource table and is gone after a restart, but the *knowledge* that a
///   newer version exists is not).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateState {
    pub current_version: String,
    pub channel: String,
    pub auto_check: bool,
    pub last_checked_at: Option<String>,
    pub last_successful_check_at: Option<String>,
    pub available_version: Option<String>,
    pub release_date: Option<String>,
    pub release_notes: Option<String>,
    pub download_bytes: Option<u64>,
    pub download_total: Option<u64>,
    pub status: Option<String>,
}

/// A missing or unreadable state file is treated as a fresh install:
/// auto-check is ON and the channel is stable, so the app performs
/// its background startup check instead of silently never checking.
impl Default for UpdateState {
    fn default() -> Self {
        Self {
            current_version: "0.0.0".into(),
            channel: "stable".into(),
            auto_check: true,
            last_checked_at: None,
            last_successful_check_at: None,
            available_version: None,
            release_date: None,
            release_notes: None,
            download_bytes: None,
            download_total: None,
            status: None,
        }
    }
}

fn update_state_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Whim")
        .join("update-state.json")
}

fn normalize(state: &mut UpdateState) {
    if !ALLOWED_CHANNELS.contains(&state.channel.as_str()) {
        state.channel = "stable".to_string();
    }
    if state.current_version.trim().is_empty() {
        state.current_version = "0.0.0".to_string();
    }
}

pub(crate) fn load_update_state_from_disk() -> UpdateState {
    let path = update_state_path();
    let Ok(metadata) = fs::metadata(&path) else {
        return UpdateState::default();
    };
    if metadata.len() > MAX_UPDATE_STATE_BYTES {
        return UpdateState::default();
    }
    let Ok(content) = fs::read_to_string(path) else {
        return UpdateState::default();
    };
    let Ok(mut state) = serde_json::from_str::<UpdateState>(&content) else {
        return UpdateState::default();
    };
    normalize(&mut state);
    state
}

fn persist_update_state(state: &UpdateState) -> Result<(), String> {
    let path = update_state_path();
    let directory = path
        .parent()
        .ok_or_else(|| "Update state path has no parent directory".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create the Whim config directory: {error}"))?;
    let content = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Could not serialize update state: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, content).map_err(|error| format!("Could not write update state: {error}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("Could not replace update state: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not finalize update state: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn load_update_state() -> UpdateState {
    load_update_state_from_disk()
}

#[tauri::command]
pub fn save_update_state(state: UpdateState) -> Result<(), String> {
    let mut normalized = state;
    normalize(&mut normalized);
    persist_update_state(&normalized)?;
    Ok(())
}

/// Remove the durable update-state file. Called when the persisted
/// "available" version is no longer newer than the running build (i.e. the
/// update was installed or the app was rolled back), so a stale record never
/// re-surfaces the same offer.
#[tauri::command]
pub fn clear_update_state() {
    let path = update_state_path();
    let _ = fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_recoverable_and_channel_is_known() {
        let state = UpdateState::default();
        assert_eq!(state.channel, "stable");
        assert!(state.auto_check);
    }

    #[test]
    fn unknown_channel_falls_back_to_stable() {
        let mut state = UpdateState {
            channel: "canary".into(),
            ..Default::default()
        };
        normalize(&mut state);
        assert_eq!(state.channel, "stable");
    }
}

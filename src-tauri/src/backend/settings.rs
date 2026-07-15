use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::State;

use super::{lock, BackendState};

const SETTINGS_VERSION: u32 = 1;
const MAX_SETTINGS_BYTES: u64 = 128 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub version: u32,
    pub general: GeneralSettings,
    pub personalization: PersonalizationSettings,
    pub chat: ChatSettings,
    pub appearance: AppearanceSettings,
    pub voice: VoiceSettings,
    pub computer_use: ComputerUseSettings,
    pub agent: AgentSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralSettings {
    pub show_bottom_panel: bool,
    pub suggested_prompts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PersonalizationSettings {
    pub enabled: bool,
    pub custom_instructions: String,
    pub response_style: String,
    pub project_memory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatSettings {
    pub enter_to_send: bool,
    pub show_copy_actions: bool,
    pub persist_history: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    pub accent: String,
    pub ui_font: String,
    pub code_font: String,
    pub contrast: u8,
    pub reduce_motion: String,
    pub pointer_cursors: bool,
    pub ui_font_size: u8,
    pub code_font_size: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceSettings {
    pub voice: String,
    pub language: String,
    pub dictionary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ComputerUseSettings {
    pub enabled: bool,
    pub screen_capture: bool,
    pub app_context: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentSettings {
    pub runtime: String,
    pub pi_model: String,
    pub speed: String,
    pub approval_policy: String,
    pub background_verification: bool,
    pub autonomous_janitor: bool,
    pub defer_capabilities: bool,
    pub max_parallel_agents: u8,
    pub enabled_capabilities: Vec<String>,
    pub default_adapter: String,
    pub wsl_distro: String,
    pub container_image: String,
    pub remote_host: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            general: GeneralSettings::default(),
            personalization: PersonalizationSettings::default(),
            chat: ChatSettings::default(),
            appearance: AppearanceSettings::default(),
            voice: VoiceSettings::default(),
            computer_use: ComputerUseSettings::default(),
            agent: AgentSettings::default(),
        }
    }
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            show_bottom_panel: true,
            suggested_prompts: true,
        }
    }
}

impl Default for PersonalizationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            custom_instructions: String::new(),
            response_style: "normal".into(),
            project_memory: true,
        }
    }
}

impl Default for ChatSettings {
    fn default() -> Self {
        Self {
            enter_to_send: true,
            show_copy_actions: true,
            persist_history: true,
        }
    }
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            accent: "#72c99f".into(),
            ui_font: "IBM Plex Sans Variable".into(),
            code_font: "JetBrains Mono Variable".into(),
            contrast: 60,
            reduce_motion: "system".into(),
            pointer_cursors: true,
            ui_font_size: 14,
            code_font_size: 13,
        }
    }
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            voice: "alloy".into(),
            language: "auto".into(),
            dictionary: String::new(),
        }
    }
}

impl Default for ComputerUseSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            screen_capture: true,
            app_context: true,
        }
    }
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            runtime: "native".into(),
            pi_model: "opencode/big-pickle".into(),
            speed: "balanced".into(),
            approval_policy: "risky".into(),
            background_verification: true,
            autonomous_janitor: true,
            defer_capabilities: true,
            max_parallel_agents: 4,
            enabled_capabilities: vec![
                "workspace".into(),
                "research".into(),
                "coding".into(),
                "verification".into(),
                "pi-delegation".into(),
            ],
            default_adapter: "native".into(),
            wsl_distro: "Ubuntu".into(),
            container_image: "ubuntu:latest".into(),
            remote_host: "user@localhost".into(),
        }
    }
}

fn one_of(value: &str, allowed: &[&str], label: &str) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("Invalid {label}: {value}"))
    }
}

fn validate_font(value: &str, label: &str) -> Result<(), String> {
    let length = value.chars().count();
    if !(1..=120).contains(&length) || value.chars().any(char::is_control) {
        return Err(format!("{label} must be 1 to 120 printable characters"));
    }
    Ok(())
}

fn valid_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

pub(crate) fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    if settings.version != SETTINGS_VERSION {
        return Err(format!(
            "Unsupported settings version {}; expected {SETTINGS_VERSION}",
            settings.version
        ));
    }
    if !valid_hex_color(&settings.appearance.accent) {
        return Err("Accent must be a six-digit hexadecimal color".into());
    }
    validate_font(&settings.appearance.ui_font, "UI font")?;
    validate_font(&settings.appearance.code_font, "Code font")?;
    if settings.appearance.contrast > 100 {
        return Err("Contrast must be between 0 and 100".into());
    }
    one_of(
        &settings.appearance.reduce_motion,
        &["system", "on", "off"],
        "reduced motion preference",
    )?;
    if !(11..=20).contains(&settings.appearance.ui_font_size) {
        return Err("Interface font size must be between 11 and 20".into());
    }
    if !(10..=24).contains(&settings.appearance.code_font_size) {
        return Err("Code font size must be between 10 and 24".into());
    }
    one_of(
        &settings.personalization.response_style,
        &["normal", "concise", "formal", "explanatory"],
        "response style",
    )?;
    if settings.personalization.custom_instructions.chars().count() > 8_000
        || settings
            .personalization
            .custom_instructions
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err("Custom instructions must be at most 8000 characters of printable text".into());
    }
    one_of(
        &settings.voice.voice,
        &[
            "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer",
            "verse",
        ],
        "voice",
    )?;
    one_of(
        &settings.voice.language,
        &["auto", "en", "es", "fr", "de", "ja", "zh"],
        "voice language",
    )?;
    if settings.voice.dictionary.chars().count() > 1_000
        || settings
            .voice
            .dictionary
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(
            "Dictation dictionary must be at most 1000 characters of printable text".into(),
        );
    }
    one_of(&settings.agent.runtime, &["native", "pi"], "agent runtime")?;
    if settings.agent.pi_model.chars().count() > 200
        || settings.agent.pi_model.chars().any(char::is_control)
    {
        return Err("Pi model must be at most 200 printable characters".into());
    }
    one_of(
        &settings.agent.speed,
        &["fast", "balanced", "thorough"],
        "agent speed",
    )?;
    one_of(
        &settings.agent.approval_policy,
        &["always", "risky"],
        "approval policy",
    )?;
    if !(1..=8).contains(&settings.agent.max_parallel_agents) {
        return Err("Parallel agent limit must be between 1 and 8".into());
    }
    let allowed_capabilities = [
        "workspace",
        "research",
        "coding",
        "verification",
        "desktop-context",
        "voice",
        "pi-delegation",
        "computer-use",
    ];
    if settings.agent.enabled_capabilities.len() > allowed_capabilities.len()
        || settings
            .agent
            .enabled_capabilities
            .iter()
            .any(|id| !allowed_capabilities.contains(&id.as_str()))
    {
        return Err("Enabled capabilities contain an unknown capability".into());
    }
    Ok(())
}

fn settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Whim")
        .join("settings.json")
}

pub(crate) fn load_settings_from_disk() -> AppSettings {
    let path = settings_path();
    let Ok(metadata) = fs::metadata(&path) else {
        return AppSettings::default();
    };
    if metadata.len() > MAX_SETTINGS_BYTES {
        return AppSettings::default();
    }
    let Ok(content) = fs::read_to_string(path) else {
        return AppSettings::default();
    };
    let Ok(settings) = serde_json::from_str::<AppSettings>(&content) else {
        return AppSettings::default();
    };
    if validate_settings(&settings).is_err() {
        return AppSettings::default();
    }
    settings
}

fn persist_settings(settings: &AppSettings) -> Result<(), String> {
    validate_settings(settings)?;
    let path = settings_path();
    let directory = path
        .parent()
        .ok_or_else(|| "Settings path has no parent directory".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create the Whim config directory: {error}"))?;
    let content = serde_json::to_vec_pretty(settings)
        .map_err(|error| format!("Could not serialize settings: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, content).map_err(|error| format!("Could not write settings: {error}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("Could not replace settings: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not finalize settings: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_app_settings(state: State<'_, BackendState>) -> Result<AppSettings, String> {
    Ok(lock(&state.settings, "settings")?.clone())
}

#[tauri::command]
pub fn save_app_settings(
    state: State<'_, BackendState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    validate_settings(&settings)?;
    persist_settings(&settings)?;
    *lock(&state.settings, "settings")? = settings.clone();
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid_and_do_not_disable_approvals() {
        let settings = AppSettings::default();
        validate_settings(&settings).unwrap();
        assert_eq!(settings.agent.approval_policy, "risky");
        assert_eq!(settings.agent.runtime, "native");
        assert!(settings.agent.background_verification);
        assert!(settings.agent.autonomous_janitor);
        assert!(settings.personalization.enabled);
        assert!(settings.personalization.project_memory);
        assert_eq!(settings.personalization.response_style, "normal");
        assert_eq!(settings.appearance.reduce_motion, "system");
        assert_eq!(settings.appearance.ui_font_size, 14);
        assert_eq!(settings.appearance.code_font_size, 13);
        assert!(!settings.computer_use.enabled);
    }

    #[test]
    fn rejects_unknown_capabilities_and_unsafe_values() {
        let mut settings = AppSettings::default();
        settings
            .agent
            .enabled_capabilities
            .push("shell-anywhere".into());
        assert!(validate_settings(&settings).is_err());
        settings = AppSettings::default();
        settings.appearance.accent = "red".into();
        assert!(validate_settings(&settings).is_err());
        settings = AppSettings::default();
        settings.agent.approval_policy = "never".into();
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn computer_use_is_a_valid_opt_in_capability() {
        let mut settings = AppSettings::default();
        assert!(!settings
            .agent
            .enabled_capabilities
            .iter()
            .any(|id| id == "computer-use"));
        settings
            .agent
            .enabled_capabilities
            .push("computer-use".into());
        validate_settings(&settings).unwrap();
    }

    #[test]
    fn older_version_one_files_gain_new_default_sections() {
        let mut value = serde_json::to_value(AppSettings::default()).unwrap();
        let object = value.as_object_mut().unwrap();
        object.remove("personalization");
        object.remove("chat");
        let settings: AppSettings = serde_json::from_value(value).unwrap();
        assert_eq!(settings.personalization, PersonalizationSettings::default());
        assert_eq!(settings.chat, ChatSettings::default());
        validate_settings(&settings).unwrap();
    }

    #[test]
    fn older_nested_settings_gain_runtime_defaults() {
        let value = serde_json::json!({
            "version": 1,
            "appearance": { "accent": "#72c99f", "uiFont": "Segoe UI", "codeFont": "Consolas", "contrast": 50 },
            "voice": { "voice": "alloy", "language": "auto" },
            "computerUse": { "screenCapture": true, "appContext": true }
        });
        let settings: AppSettings = serde_json::from_value(value).unwrap();
        assert_eq!(settings.appearance.reduce_motion, "system");
        assert_eq!(settings.voice.dictionary, "");
        assert!(!settings.computer_use.enabled);
        validate_settings(&settings).unwrap();
    }

    #[test]
    fn rejects_invalid_personalization_values() {
        let mut settings = AppSettings::default();
        settings.personalization.response_style = "rambling".into();
        assert!(validate_settings(&settings).is_err());
        settings = AppSettings::default();
        settings.personalization.custom_instructions = "x".repeat(8_001);
        assert!(validate_settings(&settings).is_err());
        settings = AppSettings::default();
        settings.appearance.ui_font_size = 30;
        assert!(validate_settings(&settings).is_err());
        settings = AppSettings::default();
        settings.voice.dictionary = "x".repeat(1_001);
        assert!(validate_settings(&settings).is_err());
    }
}

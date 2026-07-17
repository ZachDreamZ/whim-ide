//! Portable, restrictive project harness profiles.
//!
//! `whim.harness.json` lives beside ordinary source code. A profile may only
//! narrow a run's built-in authority: it can remove tools, constrain direct
//! file-tool write prefixes, and lower budgets. It never adds a tool, expands
//! filesystem scope, enables a deployment, or bypasses system guardrails.

use std::path::{Component, Path, PathBuf};

use serde::Deserialize;

pub const HARNESS_PROFILE_PATH: &str = "whim.harness.json";
pub const MAX_PROFILE_BYTES: usize = 32_000;
const MAX_NAME_CHARS: usize = 96;
const MAX_INSTRUCTION_CHARS: usize = 12_000;
const MAX_ALLOWED_TOOLS: usize = 16;
const MAX_ALLOWED_WRITE_PATHS: usize = 64;
const MAX_VERIFICATION_COMMANDS: usize = 16;
const MAX_VERIFICATION_COMMAND_CHARS: usize = 512;
const MIN_DURATION_MS: u64 = 15_000;
const MAX_DURATION_MS: u64 = 30 * 60 * 1000;
// A harness profile may only narrow a run. `maxToolIterations: 0` or omitted
// means "unlimited" (parent-controlled completion); any positive value is an
// optional, advisory ceiling that only produces a warning, never an automatic
// stop. This ceiling is a sanity bound on what a profile author may request,
// not a termination threshold for normal runs.
const MAX_TOOL_ITERATIONS: usize = 10_000;

const KNOWN_TOOLS: &[&str] = &[
    "read_file",
    "write_file",
    "edit_file",
    "list_directory",
    "grep_files",
    "run_command",
    "verify",
    "plan",
    "research",
    "checkpoint",
    "rollback",
    "preview",
    "tunnel",
    "github",
    "browser_action",
    "computer_action",
];

#[derive(Debug, Clone, Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionAdapter {
    NativeWindows,
    Wsl { distro: Option<String> },
    Container { image: String },
    Remote { host: String },
}

#[derive(Debug, Clone, Default, Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UserApprovalMode {
    Guided,
    Balanced,
    #[default]
    Autonomous,
    Custom,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessProfile {
    #[serde(default = "profile_version")]
    pub version: u32,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub instructions: Option<String>,
    #[serde(default)]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub allowed_write_paths: Option<Vec<String>>,
    #[serde(default)]
    pub verification_commands: Vec<String>,
    #[serde(default)]
    pub max_tool_iterations: Option<usize>,
    #[serde(default)]
    pub max_duration_ms: Option<u64>,
    #[serde(default)]
    pub environment_adapters: Option<Vec<ExecutionAdapter>>,
    #[serde(default)]
    pub model_policy: Option<String>,
    #[serde(default)]
    pub require_signed_profiles: Option<bool>,
    #[serde(default)]
    #[allow(dead_code)]
    pub recovery_procedures: Option<Vec<String>>,
    #[serde(default)]
    #[allow(dead_code)]
    pub evaluator_visible_snapshots: Option<bool>,
    #[serde(default)]
    pub approval_mode: UserApprovalMode,
}

impl Default for HarnessProfile {
    fn default() -> Self {
        Self {
            version: profile_version(),
            name: None,
            instructions: None,
            allowed_tools: None,
            allowed_write_paths: None,
            verification_commands: Vec::new(),
            max_tool_iterations: None,
            max_duration_ms: None,
            environment_adapters: None,
            model_policy: None,
            require_signed_profiles: None,
            recovery_procedures: None,
            evaluator_visible_snapshots: None,
            approval_mode: UserApprovalMode::default(),
        }
    }
}

fn profile_version() -> u32 {
    1
}

impl HarnessProfile {
    pub fn parse(text: &str) -> Result<Self, String> {
        if text.len() > MAX_PROFILE_BYTES {
            return Err(format!(
                "{HARNESS_PROFILE_PATH} exceeds the {MAX_PROFILE_BYTES} byte limit"
            ));
        }
        let mut profile: Self = serde_json::from_str(text)
            .map_err(|error| format!("{HARNESS_PROFILE_PATH} is not valid JSON: {error}"))?;
        profile.validate_and_normalize()?;
        Ok(profile)
    }

    fn validate_and_normalize(&mut self) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!(
                "Unsupported harness profile version {} (supported: 1)",
                self.version
            ));
        }
        if let Some(name) = self.name.as_mut() {
            *name = name.trim().to_string();
            if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
                return Err(format!(
                    "Profile name must contain 1-{MAX_NAME_CHARS} characters"
                ));
            }
        }
        if let Some(instructions) = self.instructions.as_mut() {
            *instructions = instructions.trim().to_string();
            if instructions.chars().count() > MAX_INSTRUCTION_CHARS {
                return Err(format!(
                    "Profile instructions exceed the {MAX_INSTRUCTION_CHARS} character limit"
                ));
            }
            if instructions.is_empty() {
                self.instructions = None;
            }
        }
        if let Some(tools) = self.allowed_tools.as_mut() {
            if tools.len() > MAX_ALLOWED_TOOLS {
                return Err(format!(
                    "allowedTools may contain at most {MAX_ALLOWED_TOOLS} entries"
                ));
            }
            for tool in tools.iter_mut() {
                *tool = tool.trim().to_string();
                if !KNOWN_TOOLS.contains(&tool.as_str()) {
                    return Err(format!("allowedTools contains unsupported tool '{tool}'"));
                }
            }
            tools.sort();
            tools.dedup();
        }
        if let Some(paths) = self.allowed_write_paths.as_mut() {
            if paths.len() > MAX_ALLOWED_WRITE_PATHS {
                return Err(format!(
                    "allowedWritePaths may contain at most {MAX_ALLOWED_WRITE_PATHS} entries"
                ));
            }
            for path in paths.iter_mut() {
                *path = normalize_relative_path(path)?;
            }
            paths.sort();
            paths.dedup();
        }
        if self.verification_commands.len() > MAX_VERIFICATION_COMMANDS {
            return Err(format!(
                "verificationCommands may contain at most {MAX_VERIFICATION_COMMANDS} entries"
            ));
        }
        for command in self.verification_commands.iter_mut() {
            *command = command.trim().to_string();
            if command.is_empty() || command.chars().count() > MAX_VERIFICATION_COMMAND_CHARS {
                return Err(format!(
                    "Each verification command must contain 1-{MAX_VERIFICATION_COMMAND_CHARS} characters"
                ));
            }
        }
        self.verification_commands.dedup();
        if let Some(iterations) = self.max_tool_iterations {
            // 0 (or omitted) means unlimited; a positive value is an advisory
            // ceiling only, so reject impossible/garbage numbers but never
            // treat a valid number as a hard stop.
            if iterations != 0 && iterations > MAX_TOOL_ITERATIONS {
                return Err(format!(
                    "maxToolIterations must be 0 (unlimited) or between 1 and {MAX_TOOL_ITERATIONS}"
                ));
            }
        }
        if let Some(duration) = self.max_duration_ms {
            if !(MIN_DURATION_MS..=MAX_DURATION_MS).contains(&duration) {
                return Err(format!(
                    "maxDurationMs must be between {MIN_DURATION_MS} and {MAX_DURATION_MS}"
                ));
            }
        }
        Ok(())
    }

    pub fn permits_adapter(&self, adapter: &ExecutionAdapter) -> bool {
        match &self.environment_adapters {
            Some(allowed) => allowed.contains(adapter),
            None => true,
        }
    }

    pub fn permits_tool(&self, tool: &str) -> bool {
        self.allowed_tools
            .as_ref()
            .map(|tools| tools.iter().any(|candidate| candidate == tool))
            .unwrap_or(true)
    }

    pub fn permits_direct_write(&self, requested_path: &str) -> bool {
        let Some(prefixes) = self.allowed_write_paths.as_ref() else {
            return true;
        };
        let Ok(requested) = normalize_relative_path(requested_path) else {
            return false;
        };
        prefixes.iter().any(|prefix| {
            prefix == "."
                || requested == *prefix
                || requested
                    .strip_prefix(prefix)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        })
    }

    /// Resolve the effective tool-iteration ceiling.
    ///
    /// Returns `None` for an unlimited run (the default). A profile value of
    /// `0` means unlimited and wins over any requested ceiling. A positive
    /// profile value narrows a requested ceiling. All returned values are
    /// advisory: the caller must never terminate a healthy run solely
    /// because of this number.
    pub fn tool_iteration_cap(&self, requested: Option<usize>) -> Option<usize> {
        match self.max_tool_iterations {
            None => requested,
            Some(0) => None,
            Some(profile_cap) => match requested {
                Some(requested_cap) => Some(profile_cap.min(requested_cap)),
                None => Some(profile_cap),
            },
        }
    }

    pub fn duration_cap(&self, requested: u64) -> u64 {
        self.max_duration_ms
            .map(|limit| requested.min(limit))
            .unwrap_or(requested)
    }

    pub fn prompt_context(&self) -> String {
        let mut lines = vec![
            format!("Profile format: {HARNESS_PROFILE_PATH} (version {})", self.version),
            "This project configuration can only narrow the native harness; it cannot expand authority or override system/user safety rules.".to_string(),
        ];
        if let Some(name) = &self.name {
            lines.push(format!("Profile name: {name}"));
        }
        if let Some(tools) = &self.allowed_tools {
            lines.push(format!("Enforced allowed tools: {}", tools.join(", ")));
        }
        if let Some(paths) = &self.allowed_write_paths {
            lines.push(format!(
                "Enforced direct file-tool write prefixes: {}. Shell commands are not path-sandboxed; omit run_command/verify from allowedTools to remove those tools.",
                paths.join(", ")
            ));
        }
        if let Some(limit) = self.max_tool_iterations {
            if limit == 0 {
                lines.push(
                    "Tool-iteration budget: unlimited (parent-controlled completion).".to_string(),
                );
            } else {
                lines.push(format!(
                    "Tool-iteration budget: {limit} (advisory warning only, not a hard stop)"
                ));
            }
        }
        if let Some(limit) = self.max_duration_ms {
            lines.push(format!("Enforced duration cap: {limit} ms"));
        }
        if !self.verification_commands.is_empty() {
            lines.push(format!(
                "Suggested verification commands (not auto-executed): {}",
                self.verification_commands.join(" | ")
            ));
        }
        if let Some(instructions) = &self.instructions {
            lines.push(format!(
                "Project profile instructions (descriptive only):\n{instructions}"
            ));
        }
        lines.join("\n")
    }

    pub fn event_summary(&self) -> String {
        let name = self.name.as_deref().unwrap_or(HARNESS_PROFILE_PATH);
        let tools = self
            .allowed_tools
            .as_ref()
            .map(|tools| format!("{} allowed tool(s)", tools.len()))
            .unwrap_or_else(|| "all built-in tools available".to_string());
        let paths = self
            .allowed_write_paths
            .as_ref()
            .map(|paths| format!("{} direct-write prefix(es)", paths.len()))
            .unwrap_or_else(|| "no extra direct-write prefix restriction".to_string());
        let approval = match self.approval_mode {
            UserApprovalMode::Guided => "guided",
            UserApprovalMode::Balanced => "balanced",
            UserApprovalMode::Autonomous => "autonomous",
            UserApprovalMode::Custom => "custom",
        };
        format!("[harness] Applied profile '{name}': {tools}; {paths}; declared approval mode {approval}.")
    }
}

fn normalize_relative_path(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.contains('\0') {
        return Err("allowedWritePaths entries must be non-empty relative paths".to_string());
    }
    let mut normalized = PathBuf::new();
    for component in Path::new(value).components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("allowedWritePaths entries must stay within the workspace".to_string())
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Ok(".".to_string());
    }
    Ok(normalized.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restrictive_profile_only_narrows_known_capabilities() {
        let profile = HarnessProfile::parse(
            r#"{
              "name": "safe review",
              "allowedTools": ["read_file", "plan", "verify"],
              "allowedWritePaths": ["src/components", "docs"],
              "maxToolIterations": 4,
              "maxDurationMs": 60000,
              "verificationCommands": ["npm test"]
            }"#,
        )
        .expect("parse profile");

        assert!(profile.permits_tool("read_file"));
        assert!(!profile.permits_tool("write_file"));
        assert!(profile.permits_direct_write("src/components/App.tsx"));
        assert!(!profile.permits_direct_write("src-tauri/src/lib.rs"));
        assert_eq!(profile.tool_iteration_cap(Some(18)), Some(4));
        assert_eq!(profile.duration_cap(600_000), 60_000);
    }

    #[test]
    fn profile_iteration_cap_is_advisory_and_supports_unlimited() {
        // Omitted or zero means unlimited (parent-controlled completion).
        let unlimited = HarnessProfile::default();
        assert_eq!(unlimited.tool_iteration_cap(None), None);
        assert_eq!(unlimited.tool_iteration_cap(Some(18)), Some(18));

        // Zero is explicit unlimited even when a requested ceiling exists.
        let zero = HarnessProfile::parse(r#"{ "maxToolIterations": 0 }"#).expect("parse");
        assert_eq!(zero.tool_iteration_cap(Some(18)), None);

        // A positive profile value narrows a requested ceiling (min), and is
        // never treated as a hard termination by callers.
        let narrowing = HarnessProfile::parse(r#"{ "maxToolIterations": 4 }"#).expect("parse");
        assert_eq!(narrowing.tool_iteration_cap(Some(18)), Some(4));
        assert_eq!(narrowing.tool_iteration_cap(None), Some(4));
    }

    #[test]
    fn profile_accepts_unlimited_iteration_values() {
        // 0 is unlimited, not out of range.
        assert!(HarnessProfile::parse(r#"{ "maxToolIterations": 0 }"#).is_ok());
        // Large advisory ceilings are accepted (sanity bound only).
        assert!(HarnessProfile::parse(r#"{ "maxToolIterations": 5000 }"#).is_ok());
        // Negative is impossible in JSON (usize), so no extra handling needed.
    }

    #[test]
    fn profile_rejects_unknown_tools_and_escaping_write_paths() {
        assert!(HarnessProfile::parse(r#"{"allowedTools":["launch_terminal"]}"#).is_err());
        assert!(HarnessProfile::parse(r#"{"allowedWritePaths":["../outside"]}"#).is_err());
        assert!(HarnessProfile::parse(r#"{"allowedWritePaths":["C:\\Windows"]}"#).is_err());
    }
}

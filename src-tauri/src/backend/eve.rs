#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::State;

use super::BackendState;

const MAX_PACKAGE_BYTES: u64 = 1024 * 1024;
const MAX_SLOT_FILES: usize = 128;
const MAX_SCAN_DEPTH: usize = 6;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EveProjectStatus {
    pub detected: bool,
    pub layout: Option<String>,
    pub package_version: Option<String>,
    pub cli_available: bool,
    pub cli_path: Option<String>,
    pub instructions_path: Option<String>,
    pub skills: Vec<String>,
    pub tools: Vec<String>,
    pub channels: Vec<String>,
    pub schedules: Vec<String>,
    pub evals: Vec<String>,
    pub compile_status: Option<String>,
    pub model: Option<String>,
    pub diagnostic_errors: Option<u64>,
    pub diagnostic_warnings: Option<u64>,
    pub create_route: Option<String>,
    pub continue_route: Option<String>,
    pub stream_route: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateEveWorkspaceRequest {
    pub workspace: String,
    pub confirmed: bool,
}

fn normalized_relative(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn collect_slot_files(root: &Path, relative: &str, extensions: &[&str]) -> Vec<String> {
    fn visit(
        root: &Path,
        directory: &Path,
        extensions: &[&str],
        depth: usize,
        output: &mut Vec<String>,
    ) {
        if depth > MAX_SCAN_DEPTH || output.len() >= MAX_SLOT_FILES {
            return;
        }
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
        entries.sort_by_key(fs::DirEntry::file_name);
        for entry in entries {
            if output.len() >= MAX_SLOT_FILES {
                break;
            }
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                visit(root, &path, extensions, depth + 1, output);
                continue;
            }
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if extensions.iter().any(|allowed| *allowed == extension) {
                if let Some(relative) = normalized_relative(root, &path) {
                    output.push(relative);
                }
            }
        }
    }

    let Ok(directory) = super::workspace::resolve_existing(root, relative, false) else {
        return Vec::new();
    };
    if !directory.is_dir() {
        return Vec::new();
    }
    let mut files = Vec::new();
    visit(root, &directory, extensions, 0, &mut files);
    files.sort();
    files
}

fn package_json(root: &Path) -> Option<Value> {
    let path = root.join("package.json");
    let metadata = fs::metadata(&path).ok()?;
    if metadata.len() == 0 || metadata.len() > MAX_PACKAGE_BYTES {
        return None;
    }
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn dependency_version(package: &Value, name: &str) -> Option<String> {
    ["dependencies", "devDependencies"]
        .into_iter()
        .find_map(|scope| package.get(scope)?.get(name)?.as_str().map(str::to_string))
}

fn instructions_path(root: &Path, nested: bool) -> Option<String> {
    let candidates: &[&str] = if nested {
        &[
            "agent/instructions.md",
            "agent/instructions.ts",
            "agent/instructions",
        ]
    } else {
        &["instructions.md", "instructions.ts", "instructions"]
    };
    candidates
        .iter()
        .find(|relative| root.join(relative).exists())
        .map(|relative| (*relative).to_string())
}

fn local_eve_launcher(root: &Path) -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) {
        &["eve.exe", "eve.cmd", "eve.bat", "eve.ps1"]
    } else {
        &["eve"]
    };
    names.iter().find_map(|name| {
        let candidate = root.join("node_modules").join(".bin").join(name);
        let canonical = dunce::canonicalize(&candidate).ok()?;
        canonical.starts_with(root).then_some(candidate)
    })
}

pub(crate) fn inspect_eve_root(root: &Path) -> EveProjectStatus {
    let package = package_json(root);
    let package_version = package
        .as_ref()
        .and_then(|package| dependency_version(package, "eve"));
    let nested = root.join("agent").is_dir();
    let flat = root.join("agent.ts").is_file();
    let instructions_path = instructions_path(root, nested);
    let detected = package_version.is_some() || (instructions_path.is_some() && (nested || flat));
    let cli = local_eve_launcher(root);
    let prefix = if nested { "agent/" } else { "" };
    EveProjectStatus {
        detected,
        layout: if nested {
            Some("nested".into())
        } else if flat {
            Some("flat".into())
        } else {
            None
        },
        package_version,
        cli_available: cli.is_some(),
        cli_path: cli.map(|path| path.to_string_lossy().into_owned()),
        instructions_path,
        skills: collect_slot_files(root, &format!("{prefix}skills"), &["md", "ts", "js"]),
        tools: collect_slot_files(root, &format!("{prefix}tools"), &["ts", "js", "mjs"]),
        channels: collect_slot_files(root, &format!("{prefix}channels"), &["ts", "js", "mjs"]),
        schedules: collect_slot_files(root, &format!("{prefix}schedules"), &["md", "ts", "js"]),
        evals: collect_slot_files(root, "evals", &["ts", "js", "mjs"]),
        compile_status: None,
        model: None,
        diagnostic_errors: None,
        diagnostic_warnings: None,
        create_route: None,
        continue_route: None,
        stream_route: None,
    }
}

fn parse_eve_info(stdout: &str) -> Result<Value, String> {
    let start = stdout
        .find('{')
        .ok_or_else(|| "eve info did not return a JSON object".to_string())?;
    let end = stdout
        .rfind('}')
        .ok_or_else(|| "eve info returned incomplete JSON".to_string())?;
    serde_json::from_str(&stdout[start..=end])
        .map_err(|error| format!("Cannot parse eve info output: {error}"))
}

fn merge_eve_info(status: &mut EveProjectStatus, info: &Value) {
    status.layout = info
        .get("layout")
        .and_then(Value::as_str)
        .map(str::to_string);
    status.compile_status = info
        .get("status")
        .and_then(Value::as_str)
        .map(str::to_string);
    status.model = info
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string);
    status.diagnostic_errors = info.pointer("/diagnostics/errors").and_then(Value::as_u64);
    status.diagnostic_warnings = info
        .pointer("/diagnostics/warnings")
        .and_then(Value::as_u64);
    status.create_route = info
        .pointer("/messaging/create")
        .and_then(Value::as_str)
        .map(str::to_string);
    status.continue_route = info
        .pointer("/messaging/continue")
        .and_then(Value::as_str)
        .map(str::to_string);
    status.stream_route = info
        .pointer("/messaging/stream")
        .and_then(Value::as_str)
        .map(str::to_string);
}

#[tauri::command]
pub async fn inspect_eve_workspace(
    state: State<'_, BackendState>,
    workspace: String,
) -> Result<EveProjectStatus, String> {
    let root = super::resolve_agent_workspace(state.inner(), Some(&workspace)).await?;
    Ok(inspect_eve_root(&root))
}

#[tauri::command]
pub async fn validate_eve_workspace(
    state: State<'_, BackendState>,
    request: ValidateEveWorkspaceRequest,
) -> Result<EveProjectStatus, String> {
    if !request.confirmed {
        return Err("Running eve info can compile project-authored TypeScript. Confirm project code execution first.".into());
    }
    let root = super::resolve_agent_workspace(state.inner(), Some(&request.workspace)).await?;
    let mut status = inspect_eve_root(&root);
    if !status.detected {
        return Err(
            "This workspace does not contain an Eve agent layout or Eve package dependency".into(),
        );
    }
    let launcher = local_eve_launcher(&root).ok_or_else(|| {
        "Install this Eve project's dependencies before running eve info".to_string()
    })?;
    let result = super::external_harness::capture_subscription_process(
        &launcher,
        &["info".into(), "--json".into()],
        None,
        Some(&root),
        Duration::from_secs(120),
    )
    .await?;
    if !result.success {
        let detail = if result.stderr.trim().is_empty() {
            result.stdout.trim()
        } else {
            result.stderr.trim()
        };
        return Err(if detail.is_empty() {
            "eve info failed without diagnostic output".into()
        } else {
            detail.chars().take(4_000).collect()
        });
    }
    let info = parse_eve_info(&result.stdout)?;
    merge_eve_info(&mut status, &info);
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_nested_eve_slots_without_executing_project_code() {
        let root = std::env::temp_dir().join(format!("whim-eve-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("agent/skills")).unwrap();
        fs::create_dir_all(root.join("agent/tools")).unwrap();
        fs::create_dir_all(root.join("agent/channels")).unwrap();
        fs::create_dir_all(root.join("agent/schedules")).unwrap();
        fs::create_dir_all(root.join("evals")).unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"dependencies":{"eve":"^0.24.4"}}"#,
        )
        .unwrap();
        fs::write(root.join("agent/instructions.md"), "# Identity").unwrap();
        fs::write(root.join("agent/skills/release.md"), "# Release").unwrap();
        fs::write(root.join("agent/tools/check.ts"), "export default {};").unwrap();
        fs::write(root.join("agent/channels/eve.ts"), "export default {};").unwrap();
        fs::write(
            root.join("agent/schedules/daily.md"),
            "---\ncron: daily\n---",
        )
        .unwrap();
        fs::write(root.join("evals/agent.eval.ts"), "export default {};").unwrap();

        let status = inspect_eve_root(&dunce::canonicalize(&root).unwrap());
        assert!(status.detected);
        assert_eq!(status.layout.as_deref(), Some("nested"));
        assert_eq!(status.package_version.as_deref(), Some("^0.24.4"));
        assert_eq!(
            status.instructions_path.as_deref(),
            Some("agent/instructions.md")
        );
        assert_eq!(status.skills, vec!["agent/skills/release.md"]);
        assert_eq!(status.tools, vec!["agent/tools/check.ts"]);
        assert_eq!(status.channels, vec!["agent/channels/eve.ts"]);
        assert_eq!(status.schedules, vec!["agent/schedules/daily.md"]);
        assert_eq!(status.evals, vec!["evals/agent.eval.ts"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_json_after_the_eve_cli_banner() {
        let info = parse_eve_info("eve 0.24.4\n{\"status\":\"ready\",\"model\":\"openai/test\"}\n")
            .unwrap();
        assert_eq!(info["status"], "ready");
    }
}

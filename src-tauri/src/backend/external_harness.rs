use serde::Serialize;
use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_PROBE_OUTPUT: usize = 8_192;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalHarnessStatus {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub authenticated: bool,
    pub auth_kind: String,
    pub version: Option<String>,
    pub path: Option<String>,
    pub capabilities: Vec<String>,
    pub setup_hint: String,
}

#[derive(Debug)]
pub(crate) struct CapturedProcess {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

pub(crate) fn find_launcher(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let candidates = if cfg!(windows) {
        vec![
            format!("{name}.exe"),
            format!("{name}.cmd"),
            format!("{name}.bat"),
            format!("{name}.ps1"),
        ]
    } else {
        vec![name.to_string()]
    };
    std::env::split_paths(&path)
        .flat_map(|directory| {
            candidates
                .iter()
                .map(move |candidate| directory.join(candidate))
        })
        .find(|candidate| candidate.is_file())
}

pub(crate) fn command_for_launcher(launcher: &Path) -> Command {
    let extension = launcher
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default();
    let mut command = if cfg!(windows) && extension.eq_ignore_ascii_case("ps1") {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ]);
        command.arg(launcher);
        command
    } else if cfg!(windows)
        && (extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat"))
    {
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/s", "/c"]);
        command.arg(launcher);
        command
    } else {
        Command::new(launcher)
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn provider_environment_name_is_sensitive(name: &OsStr) -> bool {
    let upper = name.to_string_lossy().to_ascii_uppercase();
    upper.ends_with("_API_KEY")
        || upper.ends_with("_TOKEN")
        || upper.ends_with("_SECRET")
        || upper.ends_with("_PASSWORD")
        || upper.ends_with("_CREDENTIAL")
        || upper.ends_with("_CREDENTIALS")
        || matches!(
            upper.as_str(),
            "GOOGLE_CLOUD_PROJECT"
                | "GOOGLE_CLOUD_QUOTA_PROJECT"
                | "GOOGLE_CLOUD_LOCATION"
                | "GOOGLE_GENAI_USE_VERTEXAI"
        )
}

pub(crate) fn scrub_provider_credentials(command: &mut Command) {
    for (name, _) in std::env::vars_os() {
        if provider_environment_name_is_sensitive(&name) {
            command.env_remove(name);
        }
    }
}

async fn capture_process_with_policy(
    launcher: &Path,
    args: &[String],
    input: Option<&str>,
    cwd: Option<&Path>,
    duration: Duration,
    subscription_only: bool,
) -> Result<CapturedProcess, String> {
    let mut command = command_for_launcher(launcher);
    if subscription_only {
        scrub_provider_credentials(&mut command);
    }
    command
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", launcher.display()))?;
    if let Some(input) = input {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input.as_bytes())
                .await
                .map_err(|error| format!("Could not write harness input: {error}"))?;
        }
    }
    match timeout(duration, child.wait_with_output()).await {
        Ok(result) => {
            let output = result.map_err(|error| format!("Harness process failed: {error}"))?;
            let mut stdout = output.stdout;
            let mut stderr = output.stderr;
            stdout.truncate(
                stdout
                    .len()
                    .min(MAX_PROBE_OUTPUT.max(crate::backend::MAX_PROCESS_OUTPUT_BYTES)),
            );
            stderr.truncate(
                stderr
                    .len()
                    .min(MAX_PROBE_OUTPUT.max(crate::backend::MAX_PROCESS_OUTPUT_BYTES)),
            );
            Ok(CapturedProcess {
                success: output.status.success(),
                exit_code: output.status.code(),
                stdout: String::from_utf8_lossy(&stdout).into_owned(),
                stderr: String::from_utf8_lossy(&stderr).into_owned(),
                timed_out: false,
            })
        }
        Err(_) => Ok(CapturedProcess {
            success: false,
            exit_code: None,
            stdout: String::new(),
            stderr: "Harness probe timed out".into(),
            timed_out: true,
        }),
    }
}

pub(crate) async fn capture_process(
    launcher: &Path,
    args: &[String],
    input: Option<&str>,
    cwd: Option<&Path>,
    duration: Duration,
) -> Result<CapturedProcess, String> {
    capture_process_with_policy(launcher, args, input, cwd, duration, false).await
}

pub(crate) async fn capture_subscription_process(
    launcher: &Path,
    args: &[String],
    input: Option<&str>,
    cwd: Option<&Path>,
    duration: Duration,
) -> Result<CapturedProcess, String> {
    capture_process_with_policy(launcher, args, input, cwd, duration, true).await
}

fn subscription_auth_kind(runtime: &str, summary: &str) -> Option<&'static str> {
    match runtime {
        "codex" if summary.contains("chatgpt") => Some("chatgpt-subscription"),
        "claude"
            if summary.contains("claude.ai")
                || summary.contains("claudeai")
                || summary.contains("subscription")
                || summary.contains("claude pro")
                || summary.contains("claude max")
                || summary.contains(r#"\"plan\":\"pro\""#)
                || summary.contains(r#"\"plan\":\"max\""#) =>
        {
            Some("claude-subscription")
        }
        "antigravity" if summary.contains("gemini") => Some("google-ai-subscription"),
        _ => None,
    }
}

fn runtime_display_name(runtime: &str) -> &str {
    match runtime {
        "codex" => "Codex",
        "claude" => "Claude Code",
        "antigravity" => "Google Antigravity",
        _ => runtime,
    }
}

pub(crate) async fn ensure_subscription_auth(
    runtime: &str,
    launcher: &Path,
) -> Result<String, String> {
    let args = match runtime {
        "codex" => vec!["login".into(), "status".into()],
        "claude" => vec!["auth".into(), "status".into()],
        "antigravity" => vec!["models".into()],
        _ => {
            return Err(format!(
                "{runtime} does not support subscription authentication"
            ))
        }
    };
    let result = capture_subscription_process(launcher, &args, None, None, PROBE_TIMEOUT).await?;
    let summary = format!("{}\n{}", result.stdout, result.stderr).to_ascii_lowercase();
    if !result.success {
        return Err(format!(
            "{} is not signed in. Authenticate in the external harness, then refresh Whim.",
            runtime_display_name(runtime)
        ));
    }
    if let Some(kind) = subscription_auth_kind(runtime, &summary) {
        return Ok(kind.into());
    }
    Err(format!(
        "{} is available, but Whim requires its subscription OAuth login for this runtime; API-key billing is not used here.",
        runtime_display_name(runtime)
    ))
}

fn compact_version(value: &str) -> Option<String> {
    let value = value.lines().find(|line| !line.trim().is_empty())?.trim();
    Some(value.chars().take(160).collect())
}

async fn probe_version(launcher: &Path, args: &[&str]) -> Option<String> {
    let args = args
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    capture_process(launcher, &args, None, None, PROBE_TIMEOUT)
        .await
        .ok()
        .and_then(|result| {
            compact_version(if result.stdout.trim().is_empty() {
                &result.stderr
            } else {
                &result.stdout
            })
        })
}

async fn codex_status() -> ExternalHarnessStatus {
    let Some(launcher) = find_launcher("codex") else {
        return ExternalHarnessStatus {
            id: "codex".into(),
            name: "Codex".into(),
            available: false,
            authenticated: false,
            auth_kind: "unavailable".into(),
            version: None,
            path: None,
            capabilities: vec![
                "coding".into(),
                "image-generation".into(),
                "subscription-oauth".into(),
            ],
            setup_hint: "Install Codex, then sign in with ChatGPT.".into(),
        };
    };
    let version = probe_version(&launcher, &["--version"]).await;
    let args = vec!["login".into(), "status".into()];
    let auth = capture_subscription_process(&launcher, &args, None, None, PROBE_TIMEOUT)
        .await
        .ok();
    let summary = auth
        .as_ref()
        .map(|result| format!("{}\n{}", result.stdout, result.stderr).to_ascii_lowercase())
        .unwrap_or_default();
    let authenticated = auth.as_ref().is_some_and(|result| result.success)
        && subscription_auth_kind("codex", &summary).is_some();
    let auth_kind = if summary.contains("chatgpt") {
        "chatgpt-subscription"
    } else if summary.contains("api key") || summary.contains("api-key") {
        "api-key"
    } else if authenticated {
        "authenticated"
    } else {
        "signed-out"
    };
    ExternalHarnessStatus {
        id: "codex".into(),
        name: "Codex".into(),
        available: true,
        authenticated,
        auth_kind: auth_kind.into(),
        version,
        path: Some(launcher.to_string_lossy().into_owned()),
        capabilities: vec![
            "coding".into(),
            "image-generation".into(),
            "subscription-oauth".into(),
        ],
        setup_hint: if authenticated {
            "Uses Codex's own cached sign-in; Whim never reads its token."
        } else {
            "Run `codex login` and choose ChatGPT sign-in."
        }
        .into(),
    }
}

async fn claude_status() -> ExternalHarnessStatus {
    let Some(launcher) = find_launcher("claude") else {
        return ExternalHarnessStatus {
            id: "claude".into(),
            name: "Claude Code".into(),
            available: false,
            authenticated: false,
            auth_kind: "unavailable".into(),
            version: None,
            path: None,
            capabilities: vec!["coding".into(), "subscription-oauth".into(), "mcp".into()],
            setup_hint: "Install Claude Code, then sign in with a Claude Pro or Max account."
                .into(),
        };
    };
    let version = probe_version(&launcher, &["--version"]).await;
    let args = vec!["auth".into(), "status".into()];
    let auth = capture_subscription_process(&launcher, &args, None, None, PROBE_TIMEOUT)
        .await
        .ok();
    let summary = auth
        .as_ref()
        .map(|result| format!("{}\n{}", result.stdout, result.stderr).to_ascii_lowercase())
        .unwrap_or_default();
    let authenticated = auth.as_ref().is_some_and(|result| result.success)
        && !summary.contains("not logged")
        && !summary.contains("signed out")
        && subscription_auth_kind("claude", &summary).is_some();
    let auth_kind =
        if summary.contains("pro") || summary.contains("max") || summary.contains("claude.ai") {
            "claude-subscription"
        } else if authenticated {
            "authenticated"
        } else {
            "signed-out-or-unknown"
        };
    ExternalHarnessStatus {
        id: "claude".into(),
        name: "Claude Code".into(),
        available: true,
        authenticated,
        auth_kind: auth_kind.into(),
        version,
        path: Some(launcher.to_string_lossy().into_owned()),
        capabilities: vec!["coding".into(), "subscription-oauth".into(), "mcp".into()],
        setup_hint: "Claude Code owns its login and credentials; use a Pro or Max subscription at its prompt.".into(),
    }
}

async fn antigravity_status() -> ExternalHarnessStatus {
    let Some(launcher) = find_launcher("agy") else {
        return ExternalHarnessStatus {
            id: "antigravity".into(),
            name: "Google Antigravity".into(),
            available: false,
            authenticated: false,
            auth_kind: "unavailable".into(),
            version: None,
            path: None,
            capabilities: vec![
                "research".into(),
                "google-oauth".into(),
                "subscription-oauth".into(),
                "read-only".into(),
            ],
            setup_hint: "Install Google Antigravity CLI, run `agy`, and sign in with the Google account that owns your AI Pro plan.".into(),
        };
    };
    let version = probe_version(&launcher, &["--version"]).await;
    let args = vec!["models".into()];
    let auth = capture_subscription_process(&launcher, &args, None, None, PROBE_TIMEOUT)
        .await
        .ok();
    let summary = auth
        .as_ref()
        .map(|result| format!("{}\n{}", result.stdout, result.stderr).to_ascii_lowercase())
        .unwrap_or_default();
    let authenticated = auth.as_ref().is_some_and(|result| result.success)
        && subscription_auth_kind("antigravity", &summary).is_some();
    ExternalHarnessStatus {
        id: "antigravity".into(),
        name: "Google Antigravity".into(),
        available: true,
        authenticated,
        auth_kind: if authenticated {
            "google-ai-subscription"
        } else {
            "signed-out-or-unknown"
        }
        .into(),
        version,
        path: Some(launcher.to_string_lossy().into_owned()),
        capabilities: vec![
            "research".into(),
            "google-oauth".into(),
            "subscription-oauth".into(),
            "read-only".into(),
        ],
        setup_hint: if authenticated {
            "Uses Antigravity's OS-keyring Google sign-in; Whim never reads its token."
        } else {
            "Run `agy` and sign in with the Google account that owns your AI Pro plan."
        }
        .into(),
    }
}

async fn simple_status(id: &str, name: &str, capability: &str) -> ExternalHarnessStatus {
    let launcher = find_launcher(id);
    let version = match &launcher {
        Some(launcher) => probe_version(launcher, &["--version"]).await,
        None => None,
    };
    ExternalHarnessStatus {
        id: id.into(),
        name: name.into(),
        available: launcher.is_some(),
        authenticated: launcher.is_some(),
        auth_kind: if launcher.is_some() {
            "runtime-owned"
        } else {
            "unavailable"
        }
        .into(),
        version,
        path: launcher.map(|path| path.to_string_lossy().into_owned()),
        capabilities: vec![capability.into()],
        setup_hint: format!("{name} keeps its own provider and authentication configuration."),
    }
}

#[tauri::command]
pub async fn discover_external_harnesses() -> Result<Vec<ExternalHarnessStatus>, String> {
    let (codex, claude, antigravity, eve, pi, opencode) = tokio::join!(
        codex_status(),
        claude_status(),
        antigravity_status(),
        simple_status("eve", "Vercel Eve", "filesystem-agent-framework"),
        simple_status("pi", "Pi Coding Agent", "portable-harness"),
        simple_status("opencode", "OpenCode", "provider-neutral")
    );
    Ok(vec![codex, claude, antigravity, eve, pi, opencode])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_launcher_is_reported_without_touching_credentials() {
        let missing = find_launcher("whim-command-that-should-not-exist");
        assert!(missing.is_none());
    }

    #[test]
    fn version_output_is_bounded_to_one_line() {
        assert_eq!(
            compact_version("tool 1.2.3\nsecret detail"),
            Some("tool 1.2.3".into())
        );
    }

    #[test]
    fn subscription_detection_does_not_accept_api_key_auth() {
        assert_eq!(
            subscription_auth_kind("codex", "logged in using chatgpt"),
            Some("chatgpt-subscription")
        );
        assert_eq!(
            subscription_auth_kind("codex", "logged in using api key"),
            None
        );
        assert_eq!(
            subscription_auth_kind("claude", r#"{\"authMethod\":\"claude.ai\"}"#),
            Some("claude-subscription")
        );
        assert_eq!(subscription_auth_kind("claude", "anthropic api key"), None);
        assert_eq!(
            subscription_auth_kind("antigravity", "gemini 3.1 pro (high)"),
            Some("google-ai-subscription")
        );
    }

    #[test]
    fn subscription_harnesses_strip_keys_and_google_billing_selectors() {
        for name in [
            "OPENAI_API_KEY",
            "ANTHROPIC_TOKEN",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_QUOTA_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "GOOGLE_GENAI_USE_VERTEXAI",
        ] {
            assert!(provider_environment_name_is_sensitive(OsStr::new(name)));
        }
        assert!(!provider_environment_name_is_sensitive(OsStr::new(
            "WHIM_THEME"
        )));
    }
}

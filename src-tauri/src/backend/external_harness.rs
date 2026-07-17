use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_PROBE_OUTPUT: usize = 8_192;

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

fn subscription_auth_kind(runtime: &str, summary: &str) -> Option<&'static str> {
    match runtime {
        "codex" if summary.contains("chatgpt") => Some("chatgpt-subscription"),
        "claude"
            if summary.contains("claude.ai")
                || summary.contains("claudeai")
                || summary.contains("subscription")
                || summary.contains("claude pro")
                || summary.contains("claude max")
                || summary.contains(r#""plan":"pro""#)
                || summary.contains(r#""plan":"max""#) =>
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_launcher_is_reported_without_touching_credentials() {
        let missing = find_launcher("whim-command-that-should-not-exist");
        assert!(missing.is_none());
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

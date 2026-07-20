use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

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

pub(crate) async fn capture_process(
    launcher: &Path,
    args: &[String],
    input: Option<&str>,
    cwd: Option<&Path>,
    duration: Duration,
) -> Result<CapturedProcess, String> {
    let mut command = command_for_launcher(launcher);
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
                .map_err(|error| format!("Could not write process input: {error}"))?;
        }
    }
    match timeout(duration, child.wait_with_output()).await {
        Ok(result) => {
            let output = result.map_err(|error| format!("Process failed: {error}"))?;
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
            stderr: "Process timed out".into(),
            timed_out: true,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_launcher_is_reported_without_touching_credentials() {
        let missing = find_launcher("whim-command-that-should-not-exist");
        assert!(missing.is_none());
    }
}

use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::State;
use tokio::{io::AsyncReadExt, process::Command, time::timeout};
use uuid::Uuid;

use super::{lock, BackendState};
use super::{DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS, MAX_PROCESS_OUTPUT_BYTES};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellRequest {
    pub command: String,
    pub confirmed: bool,
    pub timeout_ms: Option<u64>,
    pub operation_id: Option<String>,
    pub display_command: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub operation_id: String,
    pub command: String,
    pub cwd: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationInfo {
    pub operation_id: String,
    pub kind: String,
    pub pid: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelResult {
    pub operation_id: String,
    pub found: bool,
    pub termination_requested: bool,
}

pub(crate) struct ProcessSpec {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) display_command: String,
    pub(crate) cwd: PathBuf,
    pub(crate) timeout_ms: u64,
    pub(crate) environment: Vec<(String, String)>,
}

pub(crate) fn validated_operation_id(value: Option<String>) -> Result<String, String> {
    let id = value.unwrap_or_else(|| Uuid::new_v4().to_string());
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
    {
        return Err("Operation ID contains unsupported characters".to_string());
    }
    Ok(id)
}

fn validate_label(value: &str, label: &str, max_len: usize) -> Result<(), String> {
    if value.len() > max_len {
        return Err(format!(
            "{label} exceeds maximum allowed length of {max_len} characters"
        ));
    }
    Ok(())
}

pub(crate) fn validate_slug(value: &str, label: &str, max_len: usize) -> Result<(), String> {
    if value.is_empty() || value.len() > max_len {
        return Err(format!("{label} is empty or exceeds {max_len} characters"));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    {
        return Err(format!("{label} contains unsupported characters"));
    }
    Ok(())
}

pub(crate) fn clamp_timeout(requested: Option<u64>, default: u64, max: u64) -> u64 {
    requested.unwrap_or(default).clamp(1000, max)
}

pub(crate) fn preferred_powershell() -> String {
    #[cfg(windows)]
    {
        if StdCommand::new("where.exe")
            .arg("pwsh.exe")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            "pwsh.exe".to_string()
        } else {
            "powershell.exe".to_string()
        }
    }
    #[cfg(not(windows))]
    {
        "pwsh".to_string()
    }
}

pub(crate) fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }
}

pub(crate) fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(crate) fn tool_script(path: &str, args: &[String]) -> String {
    let quoted_args = args
        .iter()
        .map(|value| ps_quote(value))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "& {} {}; if ($null -ne $LASTEXITCODE) {{ exit $LASTEXITCODE }}",
        ps_quote(path),
        quoted_args
    )
}

pub(crate) fn powershell_args(script: String, interactive: bool) -> Vec<String> {
    let mut args = vec!["-NoLogo".to_string(), "-NoProfile".to_string()];
    if !interactive {
        args.push("-NonInteractive".to_string());
    }
    args.extend([
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-Command".to_string(),
        script,
    ]);
    args
}

pub(crate) fn strip_ansi(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut characters = input.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\u{1b}' {
            if character != '\u{feff}' {
                output.push(character);
            }
            continue;
        }

        match characters.peek().copied() {
            Some('[') => {
                characters.next();
                for control in characters.by_ref() {
                    if ('@'..='~').contains(&control) {
                        break;
                    }
                }
            }
            Some(']') => {
                characters.next();
                let mut saw_escape = false;
                for control in characters.by_ref() {
                    if control == '\u{7}' || (saw_escape && control == '\\') {
                        break;
                    }
                    saw_escape = control == '\u{1b}';
                }
            }
            Some(_) => {
                characters.next();
            }
            None => {}
        }
    }
    output
}

pub(crate) fn normalized_loopback_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 512 {
        return None;
    }
    let (scheme, remainder) = if let Some(value) = raw.strip_prefix("http://") {
        ("http", value)
    } else if let Some(value) = raw.strip_prefix("https://") {
        ("https", value)
    } else {
        ("http", raw)
    };

    let (host, port) = remainder.split_once(':').unwrap_or((remainder, ""));
    let host = host.trim();
    if host.is_empty() || host.len() > 256 {
        return None;
    }
    if !host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return None;
    }

    if port.is_empty() {
        Some(format!("{scheme}://{host}"))
    } else {
        let port: u16 = port.trim().parse().ok()?;
        Some(format!("{scheme}://{host}:{port}"))
    }
}

async fn read_capped<R>(reader: R) -> Result<(String, bool), String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    reader
        .take((MAX_PROCESS_OUTPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| format!("Cannot read process output: {error}"))?;

    let truncated = bytes.len() > MAX_PROCESS_OUTPUT_BYTES;
    if truncated {
        bytes.truncate(MAX_PROCESS_OUTPUT_BYTES);
    }

    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok((strip_ansi(&text), truncated))
}

async fn terminate_process_tree(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill.exe");
        command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_console(&mut command);
        command
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

pub(crate) async fn execute_tracked(
    state: &BackendState,
    operation_id: Option<String>,
    kind: &str,
    spec: ProcessSpec,
) -> Result<CommandResult, String> {
    let operation_id = validated_operation_id(operation_id)?;
    if lock(&state.operations, "operations")?.contains_key(&operation_id) {
        return Err(format!("Operation '{operation_id}' is already running"));
    }

    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("NO_COLOR", "1");
    for (name, value) in &spec.environment {
        command.env(name, value);
    }
    hide_console(&mut command);

    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|error| format!("Cannot start '{}': {error}", spec.display_command))?;
    let pid = child
        .id()
        .ok_or_else(|| "Spawned process has no process ID".to_string())?;
    let cancelled = Arc::new(AtomicBool::new(false));

    let already_running = {
        let mut operations = lock(&state.operations, "operations")?;
        if operations.contains_key(&operation_id) {
            true
        } else {
            operations.insert(
                operation_id.clone(),
                super::RunningOperation {
                    pid,
                    kind: kind.to_string(),
                    workspace: Some(spec.cwd.clone()),
                    cancelled: Arc::clone(&cancelled),
                },
            );
            false
        }
    };
    if already_running {
        let _ = terminate_process_tree(pid).await;
        return Err(format!("Operation '{operation_id}' is already running"));
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot capture process stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot capture process stderr".to_string())?;
    let stdout_task = tokio::spawn(read_capped(stdout));
    let stderr_task = tokio::spawn(read_capped(stderr));

    let mut timed_out = false;
    let status = match timeout(Duration::from_millis(spec.timeout_ms), child.wait()).await {
        Ok(status) => status.map_err(|error| format!("Cannot wait for process: {error}"))?,
        Err(_) => {
            timed_out = true;
            let _ = terminate_process_tree(pid).await;
            child
                .wait()
                .await
                .map_err(|error| format!("Cannot reap timed-out process: {error}"))?
        }
    };

    lock(&state.operations, "operations")?.remove(&operation_id);
    let (stdout, stdout_truncated) = stdout_task
        .await
        .map_err(|error| format!("Stdout reader failed: {error}"))??;
    let (stderr, stderr_truncated) = stderr_task
        .await
        .map_err(|error| format!("Stderr reader failed: {error}"))??;
    let was_cancelled = cancelled.load(Ordering::SeqCst);

    Ok(CommandResult {
        operation_id,
        command: spec.display_command,
        cwd: spec.cwd.to_string_lossy().into_owned(),
        success: status.success() && !timed_out && !was_cancelled,
        exit_code: status.code(),
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
        timed_out,
        cancelled: was_cancelled,
        duration_ms: started.elapsed().as_millis(),
    })
}

pub(crate) async fn quick_capture(
    program: &str,
    args: &[String],
    cwd: Option<&Path>,
    timeout_ms: u64,
) -> Result<(String, String, bool), String> {
    quick_capture_with_environment(program, args, cwd, timeout_ms, &[]).await
}

pub(crate) async fn quick_capture_with_environment(
    program: &str,
    args: &[String],
    cwd: Option<&Path>,
    timeout_ms: u64,
    environment: &[(String, String)],
) -> Result<(String, String, bool), String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("NO_COLOR", "1");
    for (name, value) in environment {
        command.env(name, value);
    }
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    hide_console(&mut command);
    let output = timeout(Duration::from_millis(timeout_ms), command.output())
        .await
        .map_err(|_| format!("'{program}' timed out"))?
        .map_err(|error| format!("Cannot run '{program}': {error}"))?;
    Ok((
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
        output.status.success(),
    ))
}

#[tauri::command]
pub async fn cancel_operation(
    state: State<'_, BackendState>,
    operation_id: String,
) -> Result<CancelResult, String> {
    validate_slug(&operation_id, "Operation ID", 128)?;
    let running = lock(&state.operations, "operations")?
        .get(&operation_id)
        .cloned();
    if let Some(running) = running {
        running.cancelled.store(true, Ordering::SeqCst);
        let termination_requested = terminate_process_tree(running.pid).await;
        Ok(CancelResult {
            operation_id,
            found: true,
            termination_requested,
        })
    } else {
        Ok(CancelResult {
            operation_id,
            found: false,
            termination_requested: false,
        })
    }
}

#[tauri::command]
pub fn list_active_operations(
    state: State<'_, BackendState>,
) -> Result<Vec<OperationInfo>, String> {
    let mut operations = lock(&state.operations, "operations")?
        .iter()
        .map(|(operation_id, operation)| OperationInfo {
            operation_id: operation_id.clone(),
            kind: operation.kind.clone(),
            pid: operation.pid,
        })
        .collect::<Vec<_>>();
    operations.sort_by(|left, right| left.operation_id.cmp(&right.operation_id));
    Ok(operations)
}

#[tauri::command]
pub async fn run_powershell_command(
    state: State<'_, BackendState>,
    workspace: Option<String>,
    request: PowerShellRequest,
) -> Result<CommandResult, String> {
    let root =
        super::workspace::resolve_agent_workspace(state.inner(), workspace.as_deref()).await?;
    run_powershell_command_at(state, root, request).await
}

pub(crate) async fn run_powershell_command_at(
    state: State<'_, BackendState>,
    root: PathBuf,
    request: PowerShellRequest,
) -> Result<CommandResult, String> {
    if !request.confirmed {
        return Err("PowerShell execution requires confirmed=true".to_string());
    }
    validate_label(&request.command, "PowerShell command", 64 * 1024)?;
    let timeout_ms = clamp_timeout(
        request.timeout_ms,
        DEFAULT_COMMAND_TIMEOUT_MS,
        MAX_COMMAND_TIMEOUT_MS,
    );
    execute_tracked(
        state.inner(),
        request.operation_id,
        "powershell",
        ProcessSpec {
            program: preferred_powershell(),
            args: powershell_args(request.command, false),
            display_command: request
                .display_command
                .unwrap_or_else(|| "powershell".to_string()),
            cwd: root,
            timeout_ms,
            environment: Vec::new(),
        },
    )
    .await
}

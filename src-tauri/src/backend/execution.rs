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
use tokio::{
    io::AsyncReadExt,
    net::TcpStream,
    process::Command,
    time::{sleep, timeout},
};
use uuid::Uuid;

use super::whim_route::credentials::redact_secrets;
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
    pub(crate) adapter: crate::harness::ExecutionAdapter,
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) display_command: String,
    pub(crate) cwd: PathBuf,
    pub(crate) timeout_ms: u64,
    pub(crate) environment: Vec<(String, String)>,
    pub(crate) environment_remove: Vec<String>,
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

pub(crate) async fn terminate_process_tree(pid: u32) -> bool {
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

fn command_for_spec(spec: &ProcessSpec) -> Command {
    match &spec.adapter {
        crate::harness::ExecutionAdapter::NativeWindows => {
            let mut command = Command::new(&spec.program);
            command.args(&spec.args);
            command
        }
        crate::harness::ExecutionAdapter::Wsl { distro } => {
            let mut command = Command::new("wsl.exe");
            if let Some(distro) = distro {
                command.arg("-d").arg(distro);
            }
            command.arg("--").arg(&spec.program).args(&spec.args);
            command
        }
        crate::harness::ExecutionAdapter::Container { image } => {
            let mut command = Command::new("docker");
            let cwd = spec.cwd.to_string_lossy().replace('\\', "/");
            command
                .arg("run")
                .arg("--rm")
                .arg("-v")
                .arg(format!("{cwd}:{cwd}"))
                .arg("-w")
                .arg(&cwd)
                .arg(image)
                .arg(&spec.program)
                .args(&spec.args);
            command
        }
        crate::harness::ExecutionAdapter::Remote { host } => {
            let mut command = Command::new("ssh");
            command
                .arg(host)
                .arg("--")
                .arg(&spec.program)
                .args(&spec.args);
            command
        }
    }
}

pub(crate) fn should_terminate_process_tree(pid: u32) -> bool {
    pid != 0
}

pub(crate) fn should_sanitize_verification_environment(operation_id: Option<&str>) -> bool {
    operation_id.is_some_and(|id| id.starts_with("bg-") || id.starts_with("janitor-verify-"))
}

pub(crate) async fn execute_tracked(
    state: &BackendState,
    operation_id: Option<String>,
    kind: &str,
    spec: ProcessSpec,
) -> Result<CommandResult, String> {
    let operation_id = validated_operation_id(operation_id)?;
    if lock(&state.operations, "operations").await?.contains_key(&operation_id) {
        return Err(format!("Operation '{operation_id}' is already running"));
    }

    let mut command = command_for_spec(&spec);

    command
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("NO_COLOR", "1");
    for (name, value) in &spec.environment {
        command.env(name, value);
    }
    for name in &spec.environment_remove {
        command.env_remove(name);
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
        let mut operations = lock(&state.operations, "operations").await?;
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

    lock(&state.operations, "operations").await?.remove(&operation_id);
    let (mut stdout, stdout_truncated) = stdout_task
        .await
        .map_err(|error| format!("Stdout reader failed: {error}"))??;
    let (mut stderr, stderr_truncated) = stderr_task
        .await
        .map_err(|error| format!("Stderr reader failed: {error}"))??;
    // Secrets printed by a command (echoed keys, token responses, PEM blocks)
    // must never reach the UI or agent verbatim.
    stdout = redact_secrets(&stdout);
    stderr = redact_secrets(&stderr);
    let was_cancelled = cancelled.load(Ordering::SeqCst);

    Ok(CommandResult {
        operation_id,
        command: spec.display_command.clone(),
        cwd: spec.cwd.to_string_lossy().into_owned(),
        success: status.success(),
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

/// Start a long-running process, wait until its localhost port is reachable,
/// and keep it in the operation registry until it exits or is cancelled.
pub(crate) async fn spawn_tracked_background(
    state: &BackendState,
    operation_id: Option<String>,
    kind: &str,
    spec: ProcessSpec,
    ready_port: u16,
) -> Result<CommandResult, String> {
    let operation_id = validated_operation_id(operation_id)?;
    if lock(&state.operations, "operations").await?.contains_key(&operation_id) {
        return Err(format!("Operation '{operation_id}' is already running"));
    }
    if TcpStream::connect(("127.0.0.1", ready_port)).await.is_ok() {
        return Err(format!(
            "Cannot start {} because localhost:{ready_port} is already in use",
            spec.display_command
        ));
    }

    let mut command = command_for_spec(&spec);
    command
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .env("NO_COLOR", "1");
    for (name, value) in &spec.environment {
        command.env(name, value);
    }
    for name in &spec.environment_remove {
        command.env_remove(name);
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
        let mut operations = lock(&state.operations, "operations").await?;
        if operations.contains_key(&operation_id) {
            true
        } else {
            operations.insert(
                operation_id.clone(),
                super::RunningOperation {
                    pid,
                    kind: kind.to_string(),
                    workspace: Some(spec.cwd.clone()),
                    cancelled,
                },
            );
            false
        }
    };
    if already_running {
        let _ = terminate_process_tree(pid).await;
        return Err(format!("Operation '{operation_id}' is already running"));
    }

    let ready_deadline = Instant::now() + Duration::from_millis(spec.timeout_ms);
    loop {
        if TcpStream::connect(("127.0.0.1", ready_port)).await.is_ok() {
            break;
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Cannot inspect preview process: {error}"))?
        {
            lock(&state.operations, "operations").await?.remove(&operation_id);
            return Err(format!(
                "{} exited before localhost:{ready_port} became ready (exit {:?})",
                spec.display_command,
                status.code()
            ));
        }
        if Instant::now() >= ready_deadline {
            let _ = terminate_process_tree(pid).await;
            let _ = child.wait().await;
            lock(&state.operations, "operations").await?.remove(&operation_id);
            return Err(format!(
                "{} did not open localhost:{ready_port} within {} ms",
                spec.display_command, spec.timeout_ms
            ));
        }
        sleep(Duration::from_millis(200)).await;
    }

    let operations = Arc::clone(&state.operations);
    let background_operation_id = operation_id.clone();
    tokio::spawn(async move {
        let _ = child.wait().await;
        if let Ok(mut running) = lock(&operations, "operations").await {
            if running
                .get(&background_operation_id)
                .is_some_and(|operation| operation.pid == pid)
            {
                running.remove(&background_operation_id);
            }
        }
    });

    let url = format!("http://127.0.0.1:{ready_port}");
    Ok(CommandResult {
        operation_id,
        command: spec.display_command,
        cwd: spec.cwd.to_string_lossy().into_owned(),
        success: true,
        exit_code: None,
        stdout: url,
        stderr: String::new(),
        stdout_truncated: false,
        stderr_truncated: false,
        timed_out: false,
        cancelled: false,
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
        redact_secrets(&String::from_utf8_lossy(&output.stdout)),
        redact_secrets(&String::from_utf8_lossy(&output.stderr)),
        output.status.success(),
    ))
}

#[tauri::command]
pub async fn cancel_operation(
    state: State<'_, BackendState>,
    operation_id: String,
) -> Result<CancelResult, String> {
    validate_slug(&operation_id, "Operation ID", 128)?;
    let running = lock(&state.operations, "operations").await?
        .get(&operation_id)
        .cloned();
    if let Some(running) = running {
        running.cancelled.store(true, Ordering::SeqCst);
        // Native agents use pid=0 as a cooperative-cancellation sentinel. PID
        // zero is not an OS process and must never be passed to taskkill/kill.
        let termination_requested = if should_terminate_process_tree(running.pid) {
            terminate_process_tree(running.pid).await
        } else {
            false
        };
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
    let mut operations = state
        .operations
        .blocking_lock()
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

    let profile = crate::harness::HarnessProfile::parse(
        &std::fs::read_to_string(root.join(crate::harness::HARNESS_PROFILE_PATH))
            .unwrap_or_default(),
    )
    .unwrap_or_default();

    let adapter = crate::harness::ExecutionAdapter::NativeWindows;
    if !profile.permits_adapter(&adapter) {
        return Err(format!(
            "The active {} policy forbids the {:?} execution adapter.",
            crate::harness::HARNESS_PROFILE_PATH,
            adapter
        ));
    }

    let sanitize_provider_environment =
        should_sanitize_verification_environment(request.operation_id.as_deref());
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
            adapter,
            program: preferred_powershell(),
            args: powershell_args(request.command, false),
            display_command: request
                .display_command
                .unwrap_or_else(|| "powershell".to_string()),
            cwd: root,
            timeout_ms,
            environment: Vec::new(),
            environment_remove: if sanitize_provider_environment {
                [
                    "OPENAI_API_KEY",
                    "ANTHROPIC_API_KEY",
                    "GOOGLE_API_KEY",
                    "DEEPSEEK_API_KEY",
                    "DASHSCOPE_API_KEY",
                    "XIAOMI_API_KEY",
                    "OMNIROUTE_API_KEY",
                ]
                .into_iter()
                .map(str::to_string)
                .collect()
            } else {
                Vec::new()
            },
        },
    )
    .await
}

#[allow(dead_code)]
pub trait ExecutionAdapter: Send + Sync {
    #[allow(async_fn_in_trait)]
    async fn spawn_process(
        &self,
        state: &BackendState,
        operation_id: Option<String>,
        kind: &str,
        spec: ProcessSpec,
    ) -> Result<CommandResult, String>;

    #[allow(async_fn_in_trait)]
    async fn read_file(
        &self,
        path: &Path,
        max_bytes: Option<usize>,
    ) -> Result<(String, bool), String>;

    #[allow(async_fn_in_trait)]
    async fn write_file(&self, path: &Path, content: &str) -> Result<usize, String>;
}

#[allow(dead_code)]
pub struct NativeWindowsAdapter;

impl ExecutionAdapter for NativeWindowsAdapter {
    async fn spawn_process(
        &self,
        state: &BackendState,
        operation_id: Option<String>,
        kind: &str,
        spec: ProcessSpec,
    ) -> Result<CommandResult, String> {
        execute_tracked(state, operation_id, kind, spec).await
    }

    async fn read_file(
        &self,
        path: &Path,
        max_bytes: Option<usize>,
    ) -> Result<(String, bool), String> {
        // We simulate reading file natively. In reality, it would call workspace read directly.
        let content = std::fs::read_to_string(path).map_err(|e| format!("Read failed: {e}"))?;
        let max = max_bytes.unwrap_or(super::MAX_READ_BYTES);
        let truncated = content.len() > max;
        let mut text = content;
        if truncated {
            text.truncate(max);
        }
        Ok((text, truncated))
    }

    async fn write_file(&self, path: &Path, content: &str) -> Result<usize, String> {
        std::fs::write(path, content).map_err(|e| format!("Write failed: {e}"))?;
        Ok(content.len())
    }
}

#[allow(dead_code)]
pub struct WslAdapter {
    pub distro: Option<String>,
}

impl ExecutionAdapter for WslAdapter {
    async fn spawn_process(
        &self,
        state: &BackendState,
        operation_id: Option<String>,
        kind: &str,
        mut spec: ProcessSpec,
    ) -> Result<CommandResult, String> {
        let mut wsl_args = Vec::new();
        if let Some(distro) = &self.distro {
            wsl_args.push("-d".to_string());
            wsl_args.push(distro.clone());
        }
        wsl_args.push("--".to_string());
        wsl_args.push(spec.program);
        wsl_args.extend(spec.args);

        spec.program = "wsl.exe".to_string();
        spec.args = wsl_args;

        execute_tracked(state, operation_id, kind, spec).await
    }

    async fn read_file(
        &self,
        path: &Path,
        max_bytes: Option<usize>,
    ) -> Result<(String, bool), String> {
        // A real WSL adapter might shell out to wsl.exe cat, but since WSL mounts the Windows FS
        // we can often just read the file directly on the host if we have the host path.
        let content = std::fs::read_to_string(path).map_err(|e| format!("WSL Read failed: {e}"))?;
        let max = max_bytes.unwrap_or(super::MAX_READ_BYTES);
        let truncated = content.len() > max;
        let mut text = content;
        if truncated {
            text.truncate(max);
        }
        Ok((text, truncated))
    }

    async fn write_file(&self, path: &Path, content: &str) -> Result<usize, String> {
        std::fs::write(path, content).map_err(|e| format!("WSL Write failed: {e}"))?;
        Ok(content.len())
    }
}

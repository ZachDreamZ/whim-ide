use crate::orchestrator::DurableJobStore;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
};

pub mod context;
pub mod deployment;
pub mod execution;
pub mod orchestration;
pub mod provider;
pub mod reflector;
pub mod settings;
pub mod voice;
pub mod workspace;

#[cfg(test)]
mod tests;

// Re-export all Tauri commands so lib.rs remains unchanged

// Re-export every public request/result type so callers (notably `agent.rs`,
// which glob-imports `crate::backend::*`) can name them without reaching into
// the private submodules. Without these, the `#[tauri::command]` macros on the
// handlers below fail to resolve and `lib.rs` cannot generate the invoke table.
pub use workspace::{
    DirectoryListing, FileKind, ReadFileRequest, WorkspaceTreeRequest, WriteFileRequest,
};
// Internal helper commands invoked by the native agent harness. They are
// `pub(crate)` in their defining submodule; re-exporting them lets `agent.rs`
// call them through the stable `crate::backend::*` path.
pub(crate) use deployment::{
    start_local_preview_at, start_tunnel_at, verification_plan_for_root, workspace_checkpoint_at,
    workspace_rollback_at,
};
pub use deployment::{CheckpointRequest, PreviewRequest, RollbackRequest, TunnelRequest};
pub(crate) use execution::run_powershell_command_at;
pub use execution::{CommandResult, PowerShellRequest};
pub use orchestration::AgentRunResult;
pub(crate) use workspace::{
    list_workspace_tree_at, read_workspace_file_at, resolve_agent_workspace,
    write_workspace_file_at,
};

pub(crate) const MAX_READ_BYTES: usize = 8 * 1024 * 1024;
pub(crate) const MAX_WRITE_BYTES: usize = 8 * 1024 * 1024;
pub(crate) const MAX_PROCESS_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_DOTENV_FILE_BYTES: u64 = 1024 * 1024;
pub(crate) const MAX_DOTENV_VALUE_BYTES: usize = 16 * 1024;
pub(crate) const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 120_000;
pub(crate) const MAX_COMMAND_TIMEOUT_MS: u64 = 30 * 60 * 1000;
pub(crate) const DEFAULT_DEPLOY_TIMEOUT_MS: u64 = 20 * 60 * 1000;
pub(crate) const MAX_DEPLOY_TIMEOUT_MS: u64 = 2 * 60 * 60 * 1000;

pub struct BackendState {
    pub(crate) selected_workspace: Mutex<Option<PathBuf>>,
    pub(crate) operations: Mutex<HashMap<String, RunningOperation>>,
    pub(crate) orchestration: Mutex<DurableJobStore>,
    pub(crate) settings: Mutex<settings::AppSettings>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            selected_workspace: Mutex::new(None),
            operations: Mutex::new(HashMap::new()),
            orchestration: Mutex::new(DurableJobStore::default()),
            settings: Mutex::new(settings::load_settings_from_disk()),
        }
    }
}

#[derive(Clone)]
pub(crate) struct RunningOperation {
    pub(crate) pid: u32,
    pub(crate) kind: String,
    pub(crate) workspace: Option<PathBuf>,
    pub(crate) cancelled: Arc<AtomicBool>,
}

pub(crate) fn lock<'a, T>(mutex: &'a Mutex<T>, label: &str) -> Result<MutexGuard<'a, T>, String> {
    mutex.lock().map_err(|error| {
        let detail = error.to_string();
        format!("A internal resource is locked: {label} ({detail})")
    })
}

pub(crate) fn whim_err(code: &str, detail: &str) -> String {
    format!("WHIM_ERROR: {} - {}", code, detail)
}

pub(crate) fn record_orchestration_agent_evidence(
    state: &BackendState,
    operation_id: &str,
    message: &str,
) {
    let Ok(mut store) = lock(&state.orchestration, "orchestration") else {
        return;
    };
    let _ = store.append_agent_evidence_for_operation(operation_id, message);
}

/// Register a long-running native agent operation in the backend registry so
/// `cancel_operation` can find it and flip its cancellation flag. Registration
/// also takes an execution-root lease: two autonomous writers cannot race in
/// the same workspace root, while separate Git worktrees remain independently
/// runnable. Agent operations use the `pid == 0` sentinel so `cancel_operation`
/// skips `terminate_process_tree` and only sets the cooperative flag.
pub(crate) fn register_agent_operation(
    state: &BackendState,
    operation_id: &str,
    kind: &str,
    root: &Path,
) -> Result<(), String> {
    let mut operations = lock(&state.operations, "operations")?;
    if operations
        .values()
        .any(|operation| operation.workspace.as_deref() == Some(root))
    {
        return Err(format!(
            "An agent is already running in this workspace root; use a distinct registered worktree ({root:?})"
        ));
    }
    operations.insert(
        operation_id.to_string(),
        RunningOperation {
            pid: 0,
            kind: kind.to_string(),
            workspace: Some(root.to_path_buf()),
            cancelled: Arc::new(AtomicBool::new(false)),
        },
    );
    Ok(())
}

/// True only while the operation is registered and its cancellation flag is
/// set. Once `finish_operation` removes the entry, this returns false even if
/// the flag was previously true — callers must capture the value beforehand.
pub(crate) fn is_operation_cancelled(state: &BackendState, operation_id: &str) -> bool {
    match lock(&state.operations, "operations") {
        Ok(operations) => operations
            .get(operation_id)
            .map(|operation| operation.cancelled.load(Ordering::SeqCst))
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Remove an operation from the registry. After this returns, lookups for the
/// operation id report it as not-cancelled (the entry is gone).
pub(crate) fn finish_operation(state: &BackendState, operation_id: &str) {
    if let Ok(mut operations) = lock(&state.operations, "operations") {
        operations.remove(operation_id);
    }
}

/// Detect the best available provider with zero configuration. Local models
/// win when explicitly pointed at; otherwise the first cloud provider whose
/// API key is present in the environment is chosen; as a final fallback we
/// assume a local Ollama instance so a run can still be attempted.
pub(crate) fn auto_provider() -> Option<(String, Option<String>)> {
    let omniroute = "127.0.0.1:20128"
        .parse()
        .ok()
        .and_then(|address| {
            std::net::TcpStream::connect_timeout(&address, std::time::Duration::from_millis(250))
                .ok()
        })
        .is_some();
    if omniroute {
        return Some((
            "omniroute".to_string(),
            Some("http://127.0.0.1:20128/v1".to_string()),
        ));
    }
    if std::env::var("OLLAMA_HOST").is_ok() || std::env::var("LM_STUDIO_BASE_URL").is_ok() {
        return Some((
            "local".to_string(),
            Some("http://localhost:11434".to_string()),
        ));
    }
    for (provider, env_var) in [
        ("openai", "OPENAI_API_KEY"),
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("google", "GOOGLE_API_KEY"),
        ("deepseek", "DEEPSEEK_API_KEY"),
        ("qwen", "DASHSCOPE_API_KEY"),
        ("xiaomi", "XIAOMI_API_KEY"),
    ] {
        if let Ok(value) = std::env::var(env_var) {
            if !value.trim().is_empty() {
                return Some((provider.to_string(), None));
            }
        }
    }
    Some((
        "local".to_string(),
        Some("http://localhost:11434".to_string()),
    ))
}

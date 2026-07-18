use crate::orchestrator::DurableJobStore;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub mod browser;
pub mod chat;
pub mod computer;
pub mod context;
pub mod deployment;
pub mod eve;
pub mod execution;
pub mod external_harness;
pub mod media;
pub mod orchestration;
pub mod plugins;
pub mod productivity;
pub mod provider;
pub mod reflector;
pub mod settings;
pub mod voice;
pub mod codebase_index;
pub mod decomposer;
pub mod oauth;
pub mod scheduler;
pub mod synthesizer;
pub mod whim_route;
pub mod workflows;
pub mod workspace;
pub mod fs_watcher;
pub mod search;
pub mod update_state;

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
    pub(crate) selected_workspace: RwLock<Option<PathBuf>>,
    pub(crate) operations: Arc<Mutex<HashMap<String, RunningOperation>>>,
    pub(crate) orchestration: Mutex<DurableJobStore>,
    pub(crate) settings: RwLock<settings::AppSettings>,
    pub(crate) janitor_workspaces: Mutex<HashSet<PathBuf>>,
    pub(crate) codebase_watcher: Mutex<Option<crate::backend::fs_watcher::FileWatcher>>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            selected_workspace: RwLock::new(None),
            operations: Arc::new(Mutex::new(HashMap::new())),
            orchestration: Mutex::new(DurableJobStore::default()),
            settings: RwLock::new(settings::load_settings_from_disk()),
            janitor_workspaces: Mutex::new(HashSet::new()),
            codebase_watcher: Mutex::new(None),
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

pub(crate) async fn lock<'a, T>(
    mutex: &'a Mutex<T>,
    _label: &str,
) -> Result<MutexGuard<'a, T>, String> {
    Ok(mutex.lock().await)
}

pub(crate) async fn read_lock<'a, T>(
    rwlock: &'a RwLock<T>,
    _label: &str,
) -> Result<RwLockReadGuard<'a, T>, String> {
    Ok(rwlock.read().await)
}

pub(crate) async fn write_lock<'a, T>(
    rwlock: &'a RwLock<T>,
    _label: &str,
) -> Result<RwLockWriteGuard<'a, T>, String> {
    Ok(rwlock.write().await)
}

/// Synchronous lock helpers for use inside non-async contexts (e.g. tests,
/// event emitters, spawned threads). `blocking_lock` panics if called from an
/// async runtime thread that is itself holding the async lock across an await,
/// but for short critical sections that immediately release it is safe.
pub(crate) fn blocking_lock<'a, T>(
    mutex: &'a Mutex<T>,
    _label: &str,
) -> Result<MutexGuard<'a, T>, String> {
    Ok(mutex.blocking_lock())
}

pub(crate) fn whim_err(code: &str, detail: &str) -> String {
    format!("WHIM_ERROR: {} - {}", code, detail)
}

/// Write `value` as pretty JSON to `path` atomically: serialize to a temp file
/// beside the target, then `rename` over the original. A crash mid-write leaves
/// the previous file intact instead of truncating the durable artifact. The
/// serialized bytes must not exceed `max_bytes`; otherwise the write is refused
/// (consistent with the other bounded state files in this crate).
pub(crate) fn atomic_write_json<T: serde::Serialize>(
    path: &Path,
    value: &T,
    max_bytes: usize,
) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "Atomic write path has no parent directory".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create directory for {}: {error}", path.display()))?;
    let content = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Could not serialize {}: {error}", path.display()))?;
    if content.len() > max_bytes {
        return Err(format!(
            "Refusing to write {}: {} bytes exceeds the {} byte limit",
            path.display(),
            content.len(),
            max_bytes
        ));
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, content)
        .map_err(|error| format!("Could not write {}: {error}", temporary.display()))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not replace {}: {error}", path.display()))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("Could not finalize {}: {error}", path.display()))?;
    Ok(())
}

/// Bound applied to the durable task ledger (`jobs.json`). The ledger is the most
/// important artifact in the crate, so it is capped slightly below the other
/// bounded state files to force compaction rather than unbounded growth.
pub(crate) const MAX_LEDGER_BYTES: usize = 2 * 1024 * 1024;

pub(crate) fn record_orchestration_agent_evidence(
    state: &BackendState,
    operation_id: &str,
    message: &str,
) {
    let Ok(mut store) = blocking_lock(&state.orchestration, "orchestration") else {
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
pub(crate) async fn register_agent_operation(
    state: &BackendState,
    operation_id: &str,
    kind: &str,
    root: &Path,
) -> Result<(), String> {
    let mut operations = lock(&state.operations, "operations").await?;
    if operations
        .values()
        .any(|operation| operation.pid == 0 && operation.workspace.as_deref() == Some(root))
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
pub(crate) async fn is_operation_cancelled(state: &BackendState, operation_id: &str) -> bool {
    match lock(&state.operations, "operations").await {
        Ok(operations) => operations
            .get(operation_id)
            .map(|operation| operation.cancelled.load(Ordering::SeqCst))
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Remove an operation from the registry. After this returns, lookups for the
/// operation id report it as not-cancelled (the entry is gone).
pub(crate) async fn finish_operation(state: &BackendState, operation_id: &str) {
    if let Ok(mut operations) = lock(&state.operations, "operations").await {
        operations.remove(operation_id);
    }
}

/// Detect the best available provider with zero configuration. Local models
/// win when explicitly pointed at; otherwise the first cloud provider whose
/// API key is available to Whim is chosen. Availability includes supported
/// environment aliases and bounded API-key records in OpenCode's local auth
/// store. As a final fallback we assume local Ollama so a run can be attempted.
/// Probe the local network for a reachable model gateway. Each probe is a
/// blocking `TcpStream::connect_timeout`, so this must only be called from a
/// thread that is allowed to block (e.g. inside `spawn_blocking`).
fn probe_local_providers() -> Option<(String, Option<String>)> {
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
    for (port, base) in [
        (1234, "http://127.0.0.1:1234/v1"),
        (11434, "http://127.0.0.1:11434/v1"),
    ] {
        let available = format!("127.0.0.1:{port}")
            .parse()
            .ok()
            .and_then(|address| {
                std::net::TcpStream::connect_timeout(
                    &address,
                    std::time::Duration::from_millis(250),
                )
                .ok()
            })
            .is_some();
        if available {
            return Some(("local".to_string(), Some(base.to_string())));
        }
    }
    None
}

/// Detect the best available provider with zero configuration. Local models
/// win when explicitly pointed at; otherwise the first cloud provider whose
/// API key is available to Whim is chosen. Availability includes supported
/// environment aliases and bounded API-key records in OpenCode's local auth
/// store. As a final fallback we assume local Ollama so a run can be attempted.
///
/// The TCP probes are blocking, so they run on a dedicated blocking thread
/// rather than the async executor.
pub(crate) async fn auto_provider() -> Option<(String, Option<String>)> {
    if let Ok(base) = std::env::var("LM_STUDIO_BASE_URL") {
        if !base.trim().is_empty() {
            return Some(("local".to_string(), Some(base.trim().to_string())));
        }
    }
    if let Ok(host) = std::env::var("OLLAMA_HOST") {
        if !host.trim().is_empty() {
            return Some((
                "local".to_string(),
                Some(format!("{}/v1", host.trim().trim_end_matches('/'))),
            ));
        }
    }
    if let Some(found) = tauri::async_runtime::spawn_blocking(probe_local_providers)
        .await
        .ok()
        .flatten()
    {
        return Some(found);
    }
    for provider in [
        "opencode",
        "openai",
        "anthropic",
        "google",
        "deepseek",
        "qwen",
        "xiaomi",
    ] {
        if crate::agent::provider_key_available(provider) {
            return Some((provider.to_string(), None));
        }
    }
    Some((
        "local".to_string(),
        Some("http://127.0.0.1:11434/v1".to_string()),
    ))
}

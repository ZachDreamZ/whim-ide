//! File system watcher — detects file changes in the workspace and
//! auto-refreshes the codebase index.
//!
//! Uses `notify` crate (ReadDirectoryChangesW on Windows). Debounces
//! rapid events (e.g. during save) into a single re-index.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

/// State for a running file watcher.
pub struct FileWatcher {
    /// Keep the watcher alive — dropping it stops watching.
    _watcher: RecommendedWatcher,
    /// Signal the debounce thread to stop.
    stop_flag: Arc<AtomicBool>,
}

impl FileWatcher {
    /// Start watching `workspace` for file changes. Returns a handle that
    /// keeps the watcher alive — dropping it stops everything.
    pub fn start(app: AppHandle, workspace: String) -> Result<Self, String> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = stop_flag.clone();
        let app_clone = app.clone();
        let ws = workspace.clone();
        let root = PathBuf::from(&workspace);

        // Event channel (notify calls this callback from its thread)
        let (tx, rx) = std::sync::mpsc::channel::<Vec<PathBuf>>();

        let mut watcher = RecommendedWatcher::new(
            move |result: Result<Event, notify::Error>| {
                if let Ok(event) = result {
                    // Ignore metadata-only and access events
                    let should_process = matches!(
                        event.kind,
                        EventKind::Create(_)
                            | EventKind::Modify(
                                notify::event::ModifyKind::Data(_)
                                    | notify::event::ModifyKind::Any
                            )
                            | EventKind::Remove(_)
                    );
                    if should_process && !event.paths.is_empty() {
                        let _ = tx.send(event.paths);
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to create file watcher: {e}"))?;

        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch workspace '{workspace}': {e}"))?;

        // Spawn debounce + re-index thread
        std::thread::Builder::new()
            .name("whim-fs-watcher".into())
            .spawn(move || {
                let debounce = Duration::from_millis(500);
                let mut pending: Vec<PathBuf> = Vec::new();
                let mut last_activity = std::time::Instant::now();
                let mut sleeping = false;

                loop {
                    if stop_clone.load(Ordering::Relaxed) {
                        return;
                    }

                    if sleeping {
                        // Check if debounce period elapsed
                        if last_activity.elapsed() >= debounce {
                            // Time to re-index
                            let paths = std::mem::take(&mut pending);
                            let _source_file_count: usize = paths
                                .iter()
                                .filter_map(|p| {
                                    p.extension()
                                        .and_then(|e| e.to_str())
                                        .map(|e| e.to_lowercase())
                                })
                                .filter(|ext| {
                                    matches!(
                                        ext.as_str(),
                                        "ts" | "tsx"
                                            | "js" | "jsx" | "mjs" | "cjs"
                                            | "rs"
                                            | "css" | "scss" | "less"
                                            | "md" | "mdx"
                                            | "json" | "yaml" | "yml" | "toml"
                                    )
                                })
                                .count();
                            let _ = _source_file_count;

                            // Rebuild index and emit event
                            let manifest = crate::backend::codebase_index::index_codebase_impl(&ws);
                            match manifest {
                                Ok(text) => {
                                    let _ = app_clone.emit("codebase-index-refreshed", text);
                                }
                                Err(_) => {
                                    // Silently skip on error; index will retry next change
                                }
                            }

                            sleeping = false;
                        } else {
                            // Sleep a bit before checking again
                            std::thread::sleep(Duration::from_millis(100));
                        }
                    } else {
                        // Wait for new events (non-blocking poll)
                        match rx.try_recv() {
                            Ok(paths) => {
                                pending.extend(paths);
                                last_activity = std::time::Instant::now();
                                sleeping = true;
                            }
                            Err(std::sync::mpsc::TryRecvError::Empty) => {
                                std::thread::sleep(Duration::from_millis(50));
                            }
                            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                                return; // Channel closed, shut down
                            }
                        }
                    }
                }
            })
            .map_err(|e| format!("Failed to spawn watcher thread: {e}"))?;

        Ok(FileWatcher {
            _watcher: watcher,
            stop_flag,
        })
    }
}

impl Drop for FileWatcher {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

/// Tauri command: start watching a workspace for file changes.
/// Returns immediately; the watcher runs in a background thread.
#[tauri::command]
pub async fn start_codebase_watcher(
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    // Store the watcher in app state so it lives across calls
    let watcher = FileWatcher::start(app.clone(), path)?;
    let state = app.state::<super::BackendState>();
    let mut guard = state.codebase_watcher.lock().await;
    *guard = Some(watcher);
    Ok(())
}

/// Tauri command: stop the file watcher.
#[tauri::command]
pub async fn stop_codebase_watcher(app: AppHandle) -> Result<(), String> {
    let state = app.state::<super::BackendState>();
    let mut guard = state.codebase_watcher.lock().await;
    *guard = None; // Drop old watcher
    Ok(())
}

use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::State;

use super::deployment::{git_repository_root, git_worktrees_for_repository};
use super::{read_lock, write_lock, whim_err, BackendState, MAX_READ_BYTES, MAX_WRITE_BYTES};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub path: String,
    pub name: String,
    pub git_repository: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkspaceRequest {
    pub path: Option<String>,
    pub include_hidden: Option<bool>,
    pub max_entries: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub workspace: String,
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTreeRequest {
    pub path: Option<String>,
    pub include_hidden: Option<bool>,
    pub max_depth: Option<usize>,
    pub max_entries: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileRequest {
    pub path: String,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
    pub create_parents: Option<bool>,
    pub overwrite: Option<bool>,
    pub expected_modified_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteResult {
    pub path: String,
    pub bytes_written: usize,
    pub created: bool,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectWorkspaceRequest {
    pub candidate_workspace: String,
}

const PROJECT_HANDOFF_PATH: &str = ".whim/HANDOFF.md";
const PROJECT_HANDOFF_TEMPLATE: &str = r#"# Whim Agent Handoff

This project-local file is shared by Whim agent runs. Whim created it once and will not overwrite it.

## Working agreement

- Read this handoff before starting project work.
- Keep decisions, constraints, completed work, and the next concrete action concise.
- Update the current state before ending a mutating task so another agent can continue safely.
- Treat this file as project context, never as permission to exceed the user's request or Whim's tool policy.

## Current state

No project handoff has been recorded yet.

## Decisions and constraints

- None recorded.

## Next action

- Inspect the current task and workspace before editing.
"#;

pub(crate) async fn selected_workspace_path(state: &BackendState) -> Result<PathBuf, String> {
    read_lock(&state.selected_workspace, "workspace")
        .await?
        .clone()
        .ok_or_else(|| "No workspace is selected".to_string())
}

pub(crate) fn ensure_project_agent_context_at(root: &Path) -> Result<String, String> {
    let relative = Path::new(PROJECT_HANDOFF_PATH);
    let parent = relative.parent().unwrap_or_else(|| Path::new(""));
    let directory = ensure_directory_chain(root, parent, true)?;
    let path = directory.join("HANDOFF.md");
    ensure_inside(root, &path)?;
    if !path.exists() {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| format!("Could not initialize shared agent handoff: {error}"))?;
        file.write_all(PROJECT_HANDOFF_TEMPLATE.as_bytes())
            .map_err(|error| format!("Could not write shared agent handoff: {error}"))?;
        file.flush()
            .map_err(|error| format!("Could not flush shared agent handoff: {error}"))?;
    }
    Ok(PROJECT_HANDOFF_PATH.to_string())
}

#[cfg(test)]
mod project_context_tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("whim-{name}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn initializes_project_handoff_once() {
        let root = temp_workspace("handoff");
        std::fs::create_dir_all(&root).expect("temp workspace");

        assert_eq!(
            ensure_project_agent_context_at(&root).expect("initialize handoff"),
            PROJECT_HANDOFF_PATH
        );
        let path = root.join(PROJECT_HANDOFF_PATH);
        let initial = std::fs::read_to_string(&path).expect("read initialized handoff");
        assert!(initial.contains("# Whim Agent Handoff"));

        std::fs::write(&path, "# Custom handoff\nkeep this\n").expect("customize handoff");
        ensure_project_agent_context_at(&root).expect("reinitialize handoff");
        assert_eq!(
            std::fs::read_to_string(&path).expect("read preserved handoff"),
            "# Custom handoff\nkeep this\n"
        );

        let _ = std::fs::remove_dir_all(root);
    }
}

pub(crate) async fn optional_selected_workspace_path(
    state: &BackendState,
) -> Result<Option<PathBuf>, String> {
    Ok(read_lock(&state.selected_workspace, "workspace")
        .await?
        .clone()
        .filter(|path| path.is_dir()))
}

fn canonical_workspace(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Workspace path cannot be empty".to_string());
    }

    let canonical = dunce::canonicalize(path)
        .map_err(|error| format!("Cannot open workspace '{}': {error}", path.trim()))?;
    if !canonical.is_dir() {
        return Err("Selected workspace is not a directory".to_string());
    }
    Ok(canonical)
}

fn workspace_info(path: &Path) -> WorkspaceInfo {
    WorkspaceInfo {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        git_repository: path.join(".git").exists(),
    }
}

pub(crate) async fn resolve_agent_workspace(
    state: &BackendState,
    requested_workspace: Option<&str>,
) -> Result<PathBuf, String> {
    let selected = selected_workspace_path(state).await?;
    let Some(requested_workspace) = requested_workspace else {
        return Ok(selected);
    };
    let requested = canonical_workspace(requested_workspace)?;
    if requested == selected {
        return Ok(selected);
    }
    let repo_root = git_repository_root(&selected).await.map_err(|error| {
        format!("A worktree execution target requires a Git repository: {error}")
    })?;
    let worktrees = git_worktrees_for_repository(&repo_root).await?;
    if worktrees.iter().any(|worktree| {
        dunce::canonicalize(&worktree.path)
            .map(|path| path == requested)
            .unwrap_or(false)
    }) {
        let managed_root = crate::worktrees::managed_worktree_root(&repo_root)
            .map_err(|error| format!("Cannot verify managed worktree: {error}"))?;
        if !crate::worktrees::is_managed_worktree(&requested, &managed_root) {
            return Err("Agents are strictly confined to managed worktrees. Direct execution on the primary branch or unmanaged worktrees is forbidden.".to_string());
        }
        Ok(requested)
    } else {
        Err("The requested execution folder is not a registered worktree of the selected repository".to_string())
    }
}

pub(crate) fn sanitize_relative(path: &str, allow_empty: bool) -> Result<PathBuf, String> {
    if path.contains('\0') {
        return Err("Path contains an invalid null byte".to_string());
    }

    let mut safe = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(value) => safe.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("Parent-directory traversal is not allowed".to_string())
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Only workspace-relative paths are allowed".to_string())
            }
        }
    }

    if safe.as_os_str().is_empty() && !allow_empty {
        return Err("A non-empty relative path is required".to_string());
    }
    Ok(safe)
}

/// Canonicalize `path`, climbing to the nearest existing ancestor when the
/// full path does not yet exist (so prefix checks still work for files/dirs
/// that are about to be created). This keeps Windows 8.3 short names,
/// differing casing, and mixed long/short forms consistent.
fn canonicalize_lenient(path: &Path) -> PathBuf {
    if let Ok(canonical) = dunce::canonicalize(path) {
        return canonical;
    }
    let mut current = path.to_path_buf();
    while !current.as_os_str().is_empty() {
        if let Ok(canonical) = dunce::canonicalize(&current) {
            if let Ok(suffix) = path.strip_prefix(&current) {
                return canonical.join(suffix);
            }
            return canonical;
        }
        current = match current.parent() {
            Some(parent) => parent.to_path_buf(),
            None => break,
        };
    }
    path.to_path_buf()
}

pub(crate) fn ensure_inside(root: &Path, candidate: &Path) -> Result<(), String> {
    // Canonicalize both sides so that prefix comparison is robust against
    // Windows path quirks (8.3 short names like `RUNNER~1`, differing
    // casing, or mixed long/short forms between a raw temp_dir() root and
    // a dunce-canonicalized candidate).
    let canonical_root = canonicalize_lenient(root);
    let canonical_candidate = canonicalize_lenient(candidate);
    if canonical_candidate.starts_with(&canonical_root) {
        Ok(())
    } else {
        Err("Resolved path escapes the selected workspace".to_string())
    }
}

pub(crate) fn resolve_existing(
    root: &Path,
    relative: &str,
    allow_root: bool,
) -> Result<PathBuf, String> {
    let safe = sanitize_relative(relative, allow_root)?;
    let candidate = root.join(safe);
    let canonical = dunce::canonicalize(&candidate).map_err(|error| {
        whim_err(
            "WORKSPACE_PATH_UNRESOLVED",
            &format!(
                "Workspace path '{}' does not exist or cannot be opened: {error}",
                relative
            ),
        )
    })?;
    ensure_inside(root, &canonical)?;
    Ok(canonical)
}

pub(crate) fn ensure_directory_chain(
    root: &Path,
    relative: &Path,
    create_missing: bool,
) -> Result<PathBuf, String> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("Invalid parent path".to_string());
        };
        let candidate = current.join(name);

        if candidate.exists() {
            let metadata = fs::symlink_metadata(&candidate)
                .map_err(|error| format!("Cannot inspect parent directory: {error}"))?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("A path component is not a real directory".to_string());
            }
            current = candidate;
        } else if create_missing {
            fs::create_dir(&candidate)
                .map_err(|error| format!("Cannot create parent directory: {error}"))?;
            current = candidate;
        } else {
            return Err("Parent directory chain is incomplete".to_string());
        }
        ensure_inside(root, &current)?;
    }
    Ok(current)
}

fn resolve_write_target(
    root: &Path,
    relative: &str,
    create_parents: bool,
) -> Result<(PathBuf, bool), String> {
    let safe = sanitize_relative(relative, false)?;
    let file_name = safe
        .file_name()
        .ok_or_else(|| "A file name is required".to_string())?
        .to_owned();
    let parent = safe.parent().unwrap_or_else(|| Path::new(""));
    let canonical_parent = ensure_directory_chain(root, parent, create_parents)?;
    let target = canonical_parent.join(file_name);
    ensure_inside(root, &target)?;

    let existed = target.exists();
    if existed {
        let metadata = fs::symlink_metadata(&target)
            .map_err(|error| format!("Cannot inspect write target: {error}"))?;
        if metadata.is_dir() {
            return Err("Write target is a directory".to_string());
        }
        if metadata.file_type().is_symlink() {
            let canonical = target
                .canonicalize()
                .map_err(|error| format!("Cannot follow write target symlink: {error}"))?;
            ensure_inside(root, &canonical)?;
            return Ok((canonical, existed));
        }
    }

    Ok((target, existed))
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn file_entry(root: &Path, path: &Path) -> Result<FileEntry, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect '{}': {error}", path.display()))?;
    let file_type = metadata.file_type();
    let kind = if file_type.is_symlink() {
        FileKind::Symlink
    } else if metadata.is_dir() {
        FileKind::Directory
    } else if metadata.is_file() {
        FileKind::File
    } else {
        FileKind::Other
    };

    Ok(FileEntry {
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: relative_display(root, path),
        kind,
        size: if metadata.is_file() {
            metadata.len()
        } else {
            0
        },
        modified_ms: modified_ms(&metadata),
    })
}

fn sorted_children(directory: &Path, include_hidden: bool) -> Result<Vec<PathBuf>, String> {
    let mut children = fs::read_dir(directory)
        .map_err(|error| format!("Cannot list '{}': {error}", directory.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            include_hidden
                || !path
                    .file_name()
                    .map(|name| name.to_string_lossy().starts_with('.'))
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    children.sort_by(|left, right| {
        let left_directory = fs::symlink_metadata(left)
            .map(|value| value.is_dir() && !value.file_type().is_symlink())
            .unwrap_or(false);
        let right_directory = fs::symlink_metadata(right)
            .map(|value| value.is_dir() && !value.file_type().is_symlink())
            .unwrap_or(false);
        right_directory.cmp(&left_directory).then_with(|| {
            left.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
                .cmp(
                    &right
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase(),
                )
        })
    });
    Ok(children)
}

struct TreeOptions {
    max_depth: usize,
    max_entries: usize,
    include_hidden: bool,
}

fn collect_tree(
    root: &Path,
    directory: &Path,
    depth: usize,
    options: &TreeOptions,
    entries: &mut Vec<FileEntry>,
    truncated: &mut bool,
) -> Result<(), String> {
    let mut pending = VecDeque::from([(directory.to_path_buf(), depth)]);
    while let Some((current, current_depth)) = pending.pop_front() {
        if current_depth > options.max_depth {
            continue;
        }
        for child in sorted_children(&current, options.include_hidden)? {
            if entries.len() >= options.max_entries {
                *truncated = true;
                return Ok(());
            }
            let metadata = fs::symlink_metadata(&child)
                .map_err(|error| format!("Cannot inspect '{}': {error}", child.display()))?;
            entries.push(file_entry(root, &child)?);

            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && current_depth < options.max_depth
                && !is_generated_tree_directory(&child)
            {
                pending.push_back((child, current_depth + 1));
            }
        }
    }
    Ok(())
}

fn is_generated_tree_directory(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            matches!(
                name.to_ascii_lowercase().as_str(),
                "node_modules" | "target" | "dist" | "build" | "coverage" | ".next" | ".nuxt"
            )
        })
}

#[tauri::command]
pub async fn get_selected_workspace(
    state: State<'_, BackendState>,
) -> Result<Option<WorkspaceInfo>, String> {
    read_lock(&state.selected_workspace, "workspace")
        .await
        .map(|path| path.as_ref().map(|path| workspace_info(path)))
}

#[tauri::command]
pub async fn select_workspace(
    state: State<'_, BackendState>,
    request: SelectWorkspaceRequest,
) -> Result<WorkspaceInfo, String> {
    let candidate_path = canonical_workspace(&request.candidate_workspace)?;
    let info = workspace_info(&candidate_path);
    *write_lock(&state.selected_workspace, "workspace").await? = Some(candidate_path);
    Ok(info)
}

#[tauri::command]
pub async fn ensure_project_context(
    state: State<'_, BackendState>,
    workspace: String,
) -> Result<String, String> {
    let root = resolve_agent_workspace(state.inner(), Some(&workspace)).await?;
    ensure_project_agent_context_at(&root)
}

#[tauri::command]
pub async fn list_workspace(
    state: State<'_, BackendState>,
    workspace: Option<String>,
    request: ListWorkspaceRequest,
) -> Result<DirectoryListing, String> {
    let root = resolve_agent_workspace(state.inner(), workspace.as_deref()).await?;
    list_workspace_at(&root, request)
}

pub(crate) fn list_workspace_at(
    root: &Path,
    request: ListWorkspaceRequest,
) -> Result<DirectoryListing, String> {
    let relative = request.path.unwrap_or_default();
    let directory = resolve_existing(root, &relative, true)?;
    if !directory.is_dir() {
        return Err("Requested path is not a directory".to_string());
    }
    let max_entries = request.max_entries.unwrap_or(500).clamp(1, 2_000);
    let children = sorted_children(&directory, request.include_hidden.unwrap_or(false))?;
    let truncated = children.len() > max_entries;
    let entries = children
        .into_iter()
        .take(max_entries)
        .map(|path| file_entry(root, &path))
        .collect::<Result<Vec<_>, String>>()?;
    Ok(DirectoryListing {
        workspace: relative_display(root, root),
        path: relative_display(root, &directory),
        entries,
        truncated,
    })
}

#[tauri::command]
pub async fn list_workspace_tree(
    state: State<'_, BackendState>,
    workspace: Option<String>,
    request: WorkspaceTreeRequest,
) -> Result<DirectoryListing, String> {
    let root = resolve_agent_workspace(state.inner(), workspace.as_deref()).await?;
    list_workspace_tree_at(&root, request)
}

pub(crate) fn list_workspace_tree_at(
    root: &Path,
    request: WorkspaceTreeRequest,
) -> Result<DirectoryListing, String> {
    // Canonicalize the root so relative displays match the canonicalized
    // child paths returned by the filesystem walk (Windows long/short names).
    let root = canonicalize_lenient(root);
    let relative = request.path.unwrap_or_default();
    let directory = resolve_existing(&root, &relative, true)?;
    if !directory.is_dir() {
        return Err("Requested tree root is not a directory".to_string());
    }
    let max_depth = request.max_depth.unwrap_or(4).clamp(1, 12);
    let max_entries = request.max_entries.unwrap_or(2_000).clamp(1, 10_000);
    let mut entries = Vec::new();
    let mut truncated = false;
    let options = TreeOptions {
        max_depth,
        max_entries,
        include_hidden: request.include_hidden.unwrap_or(false),
    };
    collect_tree(root, &directory, 0, &options, &mut entries, &mut truncated)?;
    Ok(DirectoryListing {
        workspace: relative_display(root, root),
        path: relative_display(root, &directory),
        entries,
        truncated,
    })
}

#[tauri::command]
pub async fn read_workspace_file(
    state: State<'_, BackendState>,
    workspace: Option<String>,
    request: ReadFileRequest,
) -> Result<FileContent, String> {
    let root = resolve_agent_workspace(state.inner(), workspace.as_deref()).await?;
    read_workspace_file_at(&root, request)
}

pub(crate) fn read_workspace_file_at(
    root: &Path,
    request: ReadFileRequest,
) -> Result<FileContent, String> {
    let path = resolve_existing(root, &request.path, false)?;
    let metadata =
        fs::symlink_metadata(&path).map_err(|error| format!("Cannot inspect file: {error}"))?;
    if !metadata.is_file() {
        return Err("Path is not a file".to_string());
    }
    let max_bytes = request
        .max_bytes
        .unwrap_or(MAX_READ_BYTES)
        .clamp(1, MAX_READ_BYTES);
    let file = fs::File::open(&path).map_err(|error| format!("Cannot open file: {error}"))?;
    let mut reader = std::io::BufReader::new(file);
    let mut buffer = vec![0; max_bytes];
    use std::io::Read;
    let bytes_read = reader
        .read(&mut buffer)
        .map_err(|error| format!("Cannot read file: {error}"))?;
    buffer.truncate(bytes_read);
    Ok(FileContent {
        path: relative_display(root, &path),
        content: String::from_utf8_lossy(&buffer).into_owned(),
        size: metadata.len(),
        modified_ms: modified_ms(&metadata),
    })
}

#[tauri::command]
pub async fn write_workspace_file(
    state: State<'_, BackendState>,
    workspace: Option<String>,
    request: WriteFileRequest,
) -> Result<FileWriteResult, String> {
    let root = resolve_agent_workspace(state.inner(), workspace.as_deref()).await?;
    write_workspace_file_at(&root, request)
}

pub(crate) fn write_workspace_file_at(
    root: &Path,
    request: WriteFileRequest,
) -> Result<FileWriteResult, String> {
    let (path, existed) =
        resolve_write_target(root, &request.path, request.create_parents.unwrap_or(false))?;
    if existed && !request.overwrite.unwrap_or(true) {
        return Err("Write target already exists and overwrite was not allowed".to_string());
    }
    if let Some(expected) = request.expected_modified_ms {
        let actual = fs::symlink_metadata(&path)
            .ok()
            .and_then(|metadata| modified_ms(&metadata));
        if actual != Some(expected) {
            return Err(whim_err(
                "WORKSPACE_FILE_CONFLICT",
                "The file changed on disk after Canvas loaded it; reload before saving",
            ));
        }
    }
    let content_bytes = request.content.as_bytes();
    if content_bytes.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "File content exceeds size limit of {} MB",
            MAX_WRITE_BYTES / (1024 * 1024)
        ));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&path)
        .map_err(|error| format!("Cannot open destination file: {error}"))?;
    file.write_all(content_bytes)
        .map_err(|error| format!("Cannot write to destination file: {error}"))?;
    file.flush()
        .map_err(|error| format!("Cannot flush destination file: {error}"))?;
    let modified_ms = file
        .metadata()
        .ok()
        .and_then(|metadata| modified_ms(&metadata));
    Ok(FileWriteResult {
        path: relative_display(root, &path),
        bytes_written: content_bytes.len(),
        created: !existed,
        modified_ms,
    })
}

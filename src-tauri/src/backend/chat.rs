use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};
use tauri::State;
use uuid::Uuid;

use super::BackendState;

const CHAT_STORE_VERSION: u32 = 1;
const MAX_STORE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_THREADS: usize = 100;
const MAX_MESSAGES_PER_THREAD: usize = 200;
const MAX_MESSAGE_CHARS: usize = 100_000;
const MAX_TITLE_CHARS: usize = 200;

static CHAT_IO_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatThread {
    pub id: String,
    pub title: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub model: Option<String>,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatThreadSummary {
    pub id: String,
    pub title: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub message_count: usize,
    pub preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ChatStore {
    version: u32,
    threads: Vec<ChatThread>,
}

impl Default for ChatStore {
    fn default() -> Self {
        Self {
            version: CHAT_STORE_VERSION,
            threads: Vec::new(),
        }
    }
}

fn io_lock() -> Result<MutexGuard<'static, ()>, String> {
    CHAT_IO_LOCK
        .lock()
        .map_err(|_| "Chat history lock is unavailable".to_string())
}

fn chat_directory() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Whim")
}

fn chat_path() -> PathBuf {
    chat_directory().join("chats.json")
}

pub(crate) fn chat_runtime_workspace() -> Result<PathBuf, String> {
    let path = chat_directory().join("chat-runtime");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Could not prepare the private Chat runtime: {error}"))?;
    dunce::canonicalize(&path)
        .map_err(|error| format!("Could not resolve the private Chat runtime: {error}"))
}

fn read_store_path(path: &Path) -> Result<ChatStore, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_STORE_BYTES {
        return Err("Chat history is unexpectedly large".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let store: ChatStore = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Chat history is invalid: {error}"))?;
    if store.version != CHAT_STORE_VERSION {
        return Err(format!(
            "Unsupported chat history version {}; expected {CHAT_STORE_VERSION}",
            store.version
        ));
    }
    validate_store(&store)?;
    Ok(store)
}

fn validate_store(store: &ChatStore) -> Result<(), String> {
    if store.threads.len() > MAX_THREADS {
        return Err("Chat history contains too many threads".into());
    }
    let mut ids = HashSet::new();
    for thread in &store.threads {
        validate_thread(thread)?;
        if !ids.insert(thread.id.as_str()) {
            return Err("Chat history contains duplicate thread IDs".into());
        }
    }
    Ok(())
}

fn load_store() -> Result<ChatStore, String> {
    let path = chat_path();
    if !path.exists() {
        return Ok(ChatStore::default());
    }
    match read_store_path(&path) {
        Ok(store) => Ok(store),
        Err(primary_error) => {
            let backup = path.with_extension("json.bak");
            if backup.exists() {
                read_store_path(&backup)
            } else {
                Err(primary_error)
            }
        }
    }
}

fn persist_store(store: &ChatStore) -> Result<(), String> {
    validate_store(store)?;
    let directory = chat_directory();
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the Whim config directory: {error}"))?;
    let path = chat_path();
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Could not serialize chat history: {error}"))?;
    if bytes.len() as u64 > MAX_STORE_BYTES {
        return Err("Chat history exceeds the local storage limit".into());
    }
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Could not write chat history: {error}"))?;
    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| format!("Could not replace the chat backup: {error}"))?;
    }
    if path.exists() {
        fs::rename(&path, &backup)
            .map_err(|error| format!("Could not back up chat history: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if backup.exists() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!("Could not finalize chat history: {error}"));
    }
    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn valid_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok()
}

fn validate_thread(thread: &ChatThread) -> Result<(), String> {
    if !valid_id(&thread.id) {
        return Err("Chat thread ID must be a UUID".into());
    }
    let title_length = thread.title.trim().chars().count();
    if !(1..=MAX_TITLE_CHARS).contains(&title_length) || thread.title.chars().any(char::is_control)
    {
        return Err("Chat title must be 1 to 200 printable characters".into());
    }
    if thread.created_at_ms <= 0 || thread.updated_at_ms < thread.created_at_ms {
        return Err("Chat timestamps are invalid".into());
    }
    if thread.messages.len() > MAX_MESSAGES_PER_THREAD {
        return Err("Chat thread has too many messages".into());
    }
    if thread
        .model
        .as_ref()
        .is_some_and(|model| model.chars().count() > 300 || model.chars().any(char::is_control))
    {
        return Err("Chat model identifier is invalid".into());
    }
    for message in &thread.messages {
        if !valid_id(&message.id)
            || !matches!(message.role.as_str(), "user" | "assistant")
            || message.content.trim().is_empty()
            || message.content.chars().count() > MAX_MESSAGE_CHARS
            || message.created_at_ms <= 0
        {
            return Err("Chat message is invalid or exceeds its storage limit".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_chat_threads(
    _state: State<'_, BackendState>,
) -> Result<Vec<ChatThreadSummary>, String> {
    let _guard = io_lock()?;
    let mut threads = load_store()?.threads;
    threads.sort_by_key(|thread| std::cmp::Reverse(thread.updated_at_ms));
    Ok(threads
        .into_iter()
        .map(|thread| {
            let preview = thread
                .messages
                .last()
                .map(|message| message.content.chars().take(160).collect())
                .unwrap_or_default();
            ChatThreadSummary {
                id: thread.id,
                title: thread.title,
                created_at_ms: thread.created_at_ms,
                updated_at_ms: thread.updated_at_ms,
                message_count: thread.messages.len(),
                preview,
                workspace: thread.workspace,
                branch: thread.branch,
            }
        })
        .collect())
}

#[tauri::command]
pub fn get_chat_thread(_state: State<'_, BackendState>, id: String) -> Result<ChatThread, String> {
    if !valid_id(&id) {
        return Err("Chat thread ID must be a UUID".into());
    }
    let _guard = io_lock()?;
    load_store()?
        .threads
        .into_iter()
        .find(|thread| thread.id == id)
        .ok_or_else(|| "Chat thread was not found".to_string())
}

#[tauri::command]
pub fn save_chat_thread(
    _state: State<'_, BackendState>,
    thread: ChatThread,
) -> Result<ChatThread, String> {
    validate_thread(&thread)?;
    let _guard = io_lock()?;
    let mut store = load_store()?;
    if let Some(existing) = store.threads.iter_mut().find(|item| item.id == thread.id) {
        *existing = thread.clone();
    } else {
        store.threads.push(thread.clone());
    }
    store
        .threads
        .sort_by_key(|thread| std::cmp::Reverse(thread.updated_at_ms));
    store.threads.truncate(MAX_THREADS);
    persist_store(&store)?;
    Ok(thread)
}

#[tauri::command]
pub fn delete_chat_thread(_state: State<'_, BackendState>, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Chat thread ID must be a UUID".into());
    }
    let _guard = io_lock()?;
    let mut store = load_store()?;
    store.threads.retain(|thread| thread.id != id);
    persist_store(&store)
}

#[tauri::command]
pub fn clear_chat_threads(_state: State<'_, BackendState>) -> Result<(), String> {
    let _guard = io_lock()?;
    persist_store(&ChatStore::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_thread() -> ChatThread {
        ChatThread {
            id: Uuid::new_v4().to_string(),
            title: "A real chat".into(),
            created_at_ms: 10,
            updated_at_ms: 20,
            model: Some("auto".into()),
            messages: vec![ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "user".into(),
                content: "Hello".into(),
                created_at_ms: 10,
            }],
            workspace: Some("/test/workspace".into()),
            branch: Some("main".into()),
        }
    }

    #[test]
    fn validates_bounded_chat_threads() {
        assert!(validate_thread(&valid_thread()).is_ok());
        let mut invalid = valid_thread();
        invalid.messages[0].role = "system".into();
        assert!(validate_thread(&invalid).is_err());
        invalid = valid_thread();
        invalid.messages[0].content = "x".repeat(MAX_MESSAGE_CHARS + 1);
        assert!(validate_thread(&invalid).is_err());
    }

    #[test]
    fn rejects_duplicate_or_oversized_stores() {
        let thread = valid_thread();
        let duplicate = ChatStore {
            version: CHAT_STORE_VERSION,
            threads: vec![thread.clone(), thread],
        };
        assert!(validate_store(&duplicate).is_err());
        let oversized = ChatStore {
            version: CHAT_STORE_VERSION,
            threads: (0..=MAX_THREADS).map(|_| valid_thread()).collect(),
        };
        assert!(validate_store(&oversized).is_err());
    }
}

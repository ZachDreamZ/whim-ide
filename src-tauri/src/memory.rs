//! Observational Memory Ledger
//!
//! Stores dense, timestamped observations about the user's preferences, project
//! goals, and architectural context. This acts as a stable text ledger that is
//! prepended to the active chat context, taking full advantage of LLM Prompt Caching.

use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const LEDGER_VERSION: u32 = 1;
const MAX_OBSERVATIONS: usize = 500; // Limit observations

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub id: String,
    pub timestamp: u64,
    pub content: String,
    #[serde(default)]
    pub importance_score: u8, // 1-10
    #[serde(default)]
    pub merged: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryLedger {
    #[serde(default = "ledger_version")]
    version: u32,
    #[serde(default)]
    observations: Vec<Observation>,
}

fn ledger_version() -> u32 {
    LEDGER_VERSION
}

#[derive(Debug)]
pub struct ObservationStore {
    path: PathBuf,
}

impl ObservationStore {
    pub fn new(directory: &Path) -> Result<Self, String> {
        let path = directory.join("observations.json");
        let store = Self { path };
        store.ensure_file()?;
        Ok(store)
    }

    pub fn from_workspace(workspace_path: &str) -> Result<Self, String> {
        let directory = Path::new(workspace_path).join(".whim");
        if !directory.exists() {
            fs::create_dir_all(&directory)
                .map_err(|error| format!("Failed to create .whim directory: {}", error))?;
        }
        Self::new(&directory)
    }

    fn ensure_file(&self) -> Result<(), String> {
        if !self.path.exists() {
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Failed to create observation ledger directory: {}", error)
                })?;
            }
            let initial = MemoryLedger::default();
            self.write_ledger(&initial)?;
        }
        Ok(())
    }

    fn read_ledger(&self) -> Result<MemoryLedger, String> {
        if !self.path.exists() {
            return Ok(MemoryLedger::default());
        }

        let bytes = fs::read(&self.path)
            .map_err(|error| format!("Failed to read observation ledger: {}", error))?;

        if bytes.is_empty() {
            return Ok(MemoryLedger::default());
        }

        let ledger: MemoryLedger = serde_json::from_slice(&bytes).map_err(|error| {
            format!(
                "Failed to deserialize observation ledger at {}: {}",
                self.path.display(),
                error
            )
        })?;

        Ok(ledger)
    }

    fn write_ledger(&self, ledger: &MemoryLedger) -> Result<(), String> {
        let encoded = serde_json::to_vec_pretty(ledger)
            .map_err(|error| format!("Failed to serialize observation ledger: {}", error))?;

        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&self.path)
            .map_err(|error| format!("Failed to open observation ledger for writing: {}", error))?;

        file.write_all(&encoded)
            .map_err(|error| format!("Failed to write observation ledger: {}", error))?;

        file.sync_all()
            .map_err(|error| format!("Failed to sync observation ledger: {}", error))?;

        Ok(())
    }

    pub fn append(&mut self, content: String, importance_score: u8) -> Result<Observation, String> {
        let mut ledger = self.read_ledger()?;

        let observation = Observation {
            id: Uuid::new_v4().to_string(),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            content,
            importance_score,
            merged: false,
        };

        ledger.observations.push(observation.clone());

        if ledger.observations.len() > MAX_OBSERVATIONS {
            ledger.observations.remove(0); // extremely naive prune, reflector should handle this better
        }

        self.write_ledger(&ledger)?;
        Ok(observation)
    }

    pub fn list(&self) -> Result<Vec<Observation>, String> {
        let ledger = self.read_ledger()?;
        Ok(ledger.observations)
    }

    pub fn list_active(&self) -> Result<Vec<Observation>, String> {
        let ledger = self.read_ledger()?;
        Ok(ledger.observations.into_iter().filter(|o| !o.merged).collect())
    }

    pub fn mark_merged(&mut self, ids: Vec<String>) -> Result<(), String> {
        let mut ledger = self.read_ledger()?;
        for obs in &mut ledger.observations {
            if ids.contains(&obs.id) {
                obs.merged = true;
            }
        }
        self.write_ledger(&ledger)?;
        Ok(())
    }

    pub fn get_formatted_context(&self) -> Result<String, String> {
        let active = self.list_active()?;
        if active.is_empty() {
            return Ok(String::new());
        }

        let mut context = String::from("<observation_memory>\n");
        context.push_str("These are your persistent observational memories about the project, the user, and past context.\n");
        for obs in active {
            context.push_str(&format!("- [{}] {}\n", obs.timestamp, obs.content));
        }
        context.push_str("</observation_memory>\n");

        Ok(context)
    }
}

#[tauri::command]
pub async fn get_observational_memory(
    workspace_path: String,
) -> Result<Vec<Observation>, String> {
    let store = ObservationStore::from_workspace(&workspace_path)?;
    store.list()
}

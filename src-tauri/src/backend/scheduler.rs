//! Provider pool scheduler — round-robin assignment of sub-tasks to
//! available provider+model combinations. Tracks concurrency, rate limits,
//! and consecutive failures per provider.

#![allow(dead_code)]

use crate::orchestrator::{OrchestrationPoolStatus, ProviderPoolEntry};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_CONSECUTIVE_FAILURES: u32 = 3;
const RATE_LIMIT_COOLDOWN_MS: u64 = 30_000;

#[derive(Debug, Clone)]
pub struct PoolEntry {
    pub provider: String,
    pub model: String,
    pub label: String,
    pub status: EntryStatus,
    pub busy_since_ms: Option<u64>,
    pub consecutive_failures: u32,
    /// Rate-limited until this timestamp (unix ms). 0 = not rate limited.
    pub rate_limited_until_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntryStatus {
    Available,
    Busy,
    Degraded,
}

/// Round-robin provider pool. Call `assign` to get the next available
/// (provider, model) for a sub-task.
#[derive(Debug, Clone)]
pub struct ProviderPool {
    entries: Vec<PoolEntry>,
    cursor: usize,
}

impl ProviderPool {
    /// Build a pool from a list of known (provider, model, label) tuples.
    pub fn new(providers: Vec<(String, String, String)>) -> Self {
        Self {
            entries: providers
                .into_iter()
                .map(|(provider, model, label)| PoolEntry {
                    provider,
                    model,
                    label,
                    status: EntryStatus::Available,
                    busy_since_ms: None,
                    consecutive_failures: 0,
                    rate_limited_until_ms: 0,
                })
                .collect(),
            cursor: 0,
        }
    }

    /// Return the next ready (provider, model). Round-robins and skips
    /// busy, degraded, or rate-limited entries. Returns None if nothing
    /// is available.
    pub fn next_ready(&mut self) -> Option<(String, String)> {
        let now = now_ms();
        let len = self.entries.len();
        if len == 0 {
            return None;
        }
        for _ in 0..len {
            self.cursor = (self.cursor + 1) % len;
            let entry = &self.entries[self.cursor];
            if entry.status == EntryStatus::Available
                && now >= entry.rate_limited_until_ms
            {
                let result = Some((entry.provider.clone(), entry.model.clone()));
                return result;
            }
        }
        None
    }

    /// Mark a provider as busy (sub-task dispatched to it).
    pub fn mark_busy(&mut self, provider: &str, model: &str) {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|e| e.provider == provider && e.model == model)
        {
            entry.status = EntryStatus::Busy;
            entry.busy_since_ms = Some(now_ms());
        }
    }

    /// Mark a provider as available again (sub-task completed).
    pub fn mark_available(&mut self, provider: &str, model: &str) {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|e| e.provider == provider && e.model == model)
        {
            entry.status = EntryStatus::Available;
            entry.busy_since_ms = None;
        }
    }

    /// Record a failure. If consecutive failures exceed the threshold,
    /// mark as degraded.
    pub fn record_failure(&mut self, provider: &str, model: &str) {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|e| e.provider == provider && e.model == model)
        {
            entry.consecutive_failures += 1;
            entry.status = EntryStatus::Available;
            entry.busy_since_ms = None;
            if entry.consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                entry.status = EntryStatus::Degraded;
            }
        }
    }

    /// Record a success, resetting the failure counter.
    pub fn record_success(&mut self, provider: &str, model: &str) {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|e| e.provider == provider && e.model == model)
        {
            entry.consecutive_failures = 0;
            entry.status = EntryStatus::Available;
            entry.busy_since_ms = None;
        }
    }

    /// Apply a rate-limit cooldown to a provider.
    pub fn rate_limit(&mut self, provider: &str, model: &str) {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|e| e.provider == provider && e.model == model)
        {
            entry.rate_limited_until_ms = now_ms() + RATE_LIMIT_COOLDOWN_MS;
            entry.status = EntryStatus::Available;
            entry.busy_since_ms = None;
        }
    }

    /// Snapshot the pool for the UI.
    pub fn snapshot(&self) -> OrchestrationPoolStatus {
        OrchestrationPoolStatus {
            entries: self
                .entries
                .iter()
                .map(|e| ProviderPoolEntry {
                    provider: e.provider.clone(),
                    model: e.model.clone(),
                    label: e.label.clone(),
                    status: match e.status {
                        EntryStatus::Available => {
                            if now_ms() < e.rate_limited_until_ms {
                                "rate_limited".into()
                            } else {
                                "available".into()
                            }
                        }
                        EntryStatus::Busy => "busy".into(),
                        EntryStatus::Degraded => "degraded".into(),
                    },
                    busy_since_ms: e.busy_since_ms,
                    consecutive_failures: e.consecutive_failures,
                })
                .collect(),
            active_sub_tasks: self
                .entries
                .iter()
                .filter(|e| e.status == EntryStatus::Busy)
                .count() as u32,
            queued_sub_tasks: 0, // filled by caller
            total_providers: self.entries.len() as u32,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

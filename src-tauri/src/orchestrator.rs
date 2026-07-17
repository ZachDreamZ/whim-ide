//! Durable, local-first orchestration state.
//!
//! This module deliberately stores only task metadata and bounded evidence. It
//! never receives provider credentials or raw command output, which keeps the
//! audit trail useful without turning it into another secret store.

use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

use crate::backend::whim_route::credentials::redact_secrets;

const LEDGER_VERSION: u32 = 1;
const MAX_JOBS: usize = 250;
const MAX_EVENTS_PER_JOB: usize = 128;
const MAX_INTENT_CHARS: usize = 24_000;
const MAX_TITLE_CHARS: usize = 180;
const MAX_SUMMARY_CHARS: usize = 2_000;
const MAX_MODEL_CHARS: usize = 240;
const MIN_JOB_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_JOB_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const MAX_JOB_TIMEOUT_MS: u64 = 30 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS: u32 = 3;
const MAX_RETRY_DELAY_MS: u64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobMode {
    Auto,
    Vibe,
    Plan,
    Research,
    Build,
    Verify,
    Review,
    Ship,
    Operate,
}

impl JobMode {
    pub fn default_risk(self) -> JobRisk {
        match self {
            Self::Plan | Self::Research => JobRisk::Low,
            Self::Auto | Self::Vibe | Self::Build | Self::Verify | Self::Review => JobRisk::Medium,
            Self::Ship | Self::Operate => JobRisk::High,
        }
    }

    #[allow(dead_code)]
    pub fn agent_name(self) -> Option<&'static str> {
        match self {
            Self::Auto | Self::Vibe => Some("auto"),
            Self::Plan => Some("plan"),
            Self::Research => Some("researcher"),
            Self::Build => Some("build"),
            Self::Verify => Some("verify"),
            Self::Review => Some("review"),
            Self::Ship => Some("ship"),
            Self::Operate => Some("operate"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Running,
    Paused,
    Interrupted,
    Completed,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn is_active(self) -> bool {
        matches!(
            self,
            Self::Queued | Self::Running | Self::Paused | Self::Interrupted
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobAction {
    Start,
    Pause,
    Resume,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobOutcome {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobActor {
    User,
    Agent,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobEventKind {
    Created,
    Started,
    Paused,
    Resumed,
    Interrupted,
    Cancelled,
    Evidence,
    Completed,
    Failed,
    RetryScheduled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobBudget {
    pub max_duration_ms: u64,
    pub max_tool_iterations: u32,
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
}

impl Default for JobBudget {
    fn default() -> Self {
        Self {
            max_duration_ms: DEFAULT_JOB_TIMEOUT_MS,
            max_tool_iterations: 18,
            max_attempts: DEFAULT_MAX_ATTEMPTS,
        }
    }
}

fn default_max_attempts() -> u32 {
    DEFAULT_MAX_ATTEMPTS
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobEvidence {
    pub event_count: u32,
    pub tool_call_count: u32,
    pub failed_tool_call_count: u32,
    pub duration_ms: Option<u64>,
    pub timed_out: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationJob {
    pub id: String,
    pub workspace: String,
    pub title: String,
    pub intent: String,
    pub mode: JobMode,
    pub risk: JobRisk,
    pub status: JobStatus,
    pub budget: JobBudget,
    pub operation_id: Option<String>,
    #[serde(default)]
    pub operation_ids: Vec<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub started_at_ms: Option<u64>,
    pub finished_at_ms: Option<u64>,
    pub summary: Option<String>,
    pub evidence: JobEvidence,
    pub event_count: usize,
    #[serde(default = "default_attempt")]
    pub attempt: u32,
    #[serde(default)]
    pub next_eligible_at_ms: Option<u64>,
}

fn default_attempt() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationEvent {
    pub id: String,
    pub at_ms: u64,
    pub actor: JobActor,
    pub kind: JobEventKind,
    pub message: String,
    pub evidence: Option<JobEvidence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationJobDetail {
    pub job: OrchestrationJob,
    pub events: Vec<OrchestrationEvent>,
}

#[derive(Debug, Clone)]
pub struct CreateJobInput {
    pub workspace: String,
    pub intent: String,
    pub title: Option<String>,
    pub mode: JobMode,
    pub operation_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub max_duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredJob {
    job: OrchestrationJob,
    #[serde(default)]
    events: Vec<OrchestrationEvent>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ledger {
    #[serde(default = "ledger_version")]
    version: u32,
    #[serde(default)]
    jobs: Vec<StoredJob>,
}

fn ledger_version() -> u32 {
    LEDGER_VERSION
}

/// Filesystem-backed task state. A BackendState mutex serializes all calls so
/// read-modify-write operations remain coherent inside one Whim process.
#[derive(Debug, Clone)]
pub struct DurableJobStore {
    path: PathBuf,
    recovered_current_process: bool,
}

impl Default for DurableJobStore {
    fn default() -> Self {
        Self::at(default_store_path())
    }
}

impl DurableJobStore {
    pub fn at(path: PathBuf) -> Self {
        Self {
            path,
            recovered_current_process: false,
        }
    }

    #[cfg(test)]
    pub fn storage_path(&self) -> &std::path::Path {
        &self.path
    }

    pub fn create(&mut self, input: CreateJobInput) -> Result<OrchestrationJob, String> {
        let workspace = normalized_text(&input.workspace, 4_000);
        if workspace.is_empty() {
            return Err("A workspace is required to create a task".to_string());
        }
        let intent = audit_text(&input.intent, MAX_INTENT_CHARS);
        if intent.is_empty() {
            return Err("Task intent must not be empty".to_string());
        }

        let now = now_ms();
        let title = input
            .title
            .as_deref()
            .map(|value| audit_text(value, MAX_TITLE_CHARS))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| title_from_intent(&intent));
        let max_duration_ms = input
            .max_duration_ms
            .unwrap_or(DEFAULT_JOB_TIMEOUT_MS)
            .clamp(MIN_JOB_TIMEOUT_MS, MAX_JOB_TIMEOUT_MS);
        let operation_id = input
            .operation_id
            .map(|value| normalized_text(&value, 96))
            .filter(|value| !value.is_empty());
        let job = OrchestrationJob {
            id: Uuid::new_v4().to_string(),
            workspace,
            title,
            intent,
            mode: input.mode,
            risk: input.mode.default_risk(),
            status: JobStatus::Queued,
            budget: JobBudget {
                max_duration_ms,
                max_tool_iterations: 18,
                max_attempts: DEFAULT_MAX_ATTEMPTS,
            },
            operation_id: operation_id.clone(),
            operation_ids: operation_id.into_iter().collect(),
            provider: input
                .provider
                .map(|value| normalized_text(&value, MAX_MODEL_CHARS))
                .filter(|value| !value.is_empty()),
            model: input
                .model
                .map(|value| normalized_text(&value, MAX_MODEL_CHARS))
                .filter(|value| !value.is_empty()),
            created_at_ms: now,
            updated_at_ms: now,
            started_at_ms: None,
            finished_at_ms: None,
            summary: None,
            evidence: JobEvidence::default(),
            event_count: 0,
            attempt: 1,
            next_eligible_at_ms: None,
        };
        let event = event(
            JobActor::User,
            JobEventKind::Created,
            "Task queued with a workspace-scoped run-level authorization.",
            None,
        );

        self.mutate(|ledger| {
            if let Some(operation_id) = job.operation_id.as_deref() {
                if ledger.jobs.iter().any(|stored| {
                    stored.job.operation_id.as_deref() == Some(operation_id)
                        || stored
                            .job
                            .operation_ids
                            .iter()
                            .any(|recorded| recorded == operation_id)
                }) {
                    return Err(
                        "Task operation ID is already recorded in the local ledger".to_string()
                    );
                }
            }
            let mut stored = StoredJob {
                job: job.clone(),
                events: Vec::new(),
            };
            push_event(&mut stored, event);
            let created = stored.job.clone();
            ledger.jobs.push(stored);
            trim_ledger(ledger);
            Ok(created)
        })
    }

    pub fn list_for_workspace(&mut self, workspace: &str) -> Result<Vec<OrchestrationJob>, String> {
        let workspace = normalized_text(workspace, 4_000);
        self.mutate(|ledger| {
            let mut jobs = ledger
                .jobs
                .iter()
                .filter(|stored| stored.job.workspace == workspace)
                .map(|stored| stored.job.clone())
                .collect::<Vec<_>>();
            jobs.sort_by_key(|right| std::cmp::Reverse(right.updated_at_ms));
            Ok(jobs)
        })
    }

    #[allow(dead_code)]
    pub fn list_for_workspaces(
        &mut self,
        workspaces: &[String],
    ) -> Result<Vec<OrchestrationJob>, String> {
        let workspaces = workspaces
            .iter()
            .map(|workspace| normalized_text(workspace, 4_000))
            .filter(|workspace| !workspace.is_empty())
            .collect::<std::collections::BTreeSet<_>>();
        self.mutate(|ledger| {
            let mut jobs = ledger
                .jobs
                .iter()
                .filter(|stored| workspaces.contains(&stored.job.workspace))
                .map(|stored| stored.job.clone())
                .collect::<Vec<_>>();
            jobs.sort_by_key(|right| std::cmp::Reverse(right.updated_at_ms));
            Ok(jobs)
        })
    }

    pub fn detail(
        &mut self,
        workspace: &str,
        job_id: &str,
    ) -> Result<OrchestrationJobDetail, String> {
        let workspace = normalized_text(workspace, 4_000);
        let job_id = valid_job_id(job_id)?;
        self.mutate(|ledger| {
            let stored = find_job(&ledger.jobs, &workspace, &job_id)?;
            Ok(OrchestrationJobDetail {
                job: stored.job.clone(),
                events: stored.events.clone(),
            })
        })
    }

    pub fn transition(
        &mut self,
        workspace: &str,
        job_id: &str,
        action: JobAction,
    ) -> Result<OrchestrationJob, String> {
        let workspace = normalized_text(workspace, 4_000);
        let job_id = valid_job_id(job_id)?;
        self.mutate(|ledger| {
            let requested = find_job(&ledger.jobs, &workspace, &job_id)?;
            let wants_writer_slot = matches!(action, JobAction::Start | JobAction::Resume)
                && requested.job.mode != JobMode::Research;
            if wants_writer_slot {
                if requested
                    .job
                    .next_eligible_at_ms
                    .is_some_and(|eligible_at| eligible_at > now_ms())
                {
                    return Err("Task retry delay has not elapsed yet".to_string());
                }
                if let Some(blocking) = ledger.jobs.iter().find(|candidate| {
                    candidate.job.workspace == workspace
                        && candidate.job.id != job_id
                        && candidate.job.status == JobStatus::Running
                        && candidate.job.mode != JobMode::Research
                }) {
                    return Err(format!(
                        "Execution target is owned by running task {}. This task remains {:?}",
                        blocking.job.id, requested.job.status
                    ));
                }

                if matches!(action, JobAction::Start) && requested.job.status == JobStatus::Queued {
                    let next_queued = ledger
                        .jobs
                        .iter()
                        .filter(|candidate| {
                            candidate.job.workspace == workspace
                                && candidate.job.status == JobStatus::Queued
                        })
                        .min_by_key(|candidate| {
                            (candidate.job.created_at_ms, candidate.job.id.as_str())
                        });
                    if next_queued.is_some_and(|candidate| candidate.job.id != job_id) {
                        return Err(
                            "An earlier queued task owns the next execution slot for this target"
                                .to_string(),
                        );
                    }
                }
            }
            let stored = find_job_mut(&mut ledger.jobs, &workspace, &job_id)?;
            let now = now_ms();
            let (next_status, kind, message) = match action {
                JobAction::Start
                    if matches!(
                        stored.job.status,
                        JobStatus::Queued | JobStatus::Interrupted
                    ) =>
                {
                    (
                        JobStatus::Running,
                        JobEventKind::Started,
                        "Task execution started.",
                    )
                }
                JobAction::Pause
                    if matches!(stored.job.status, JobStatus::Queued | JobStatus::Running) =>
                {
                    (
                        JobStatus::Paused,
                        JobEventKind::Paused,
                        "Task paused by the user.",
                    )
                }
                JobAction::Resume
                    if matches!(
                        stored.job.status,
                        JobStatus::Paused | JobStatus::Interrupted
                    ) =>
                {
                    (
                        JobStatus::Running,
                        JobEventKind::Resumed,
                        "Task resumed by the user.",
                    )
                }
                JobAction::Cancel if stored.job.status.is_active() => (
                    JobStatus::Cancelled,
                    JobEventKind::Cancelled,
                    "Cancellation requested by the user.",
                ),
                _ => {
                    return Err(format!(
                        "Cannot apply {action:?} while task {} is {:?}",
                        stored.job.id, stored.job.status
                    ));
                }
            };
            stored.job.status = next_status;
            stored.job.updated_at_ms = now;
            if matches!(next_status, JobStatus::Running) && stored.job.started_at_ms.is_none() {
                stored.job.started_at_ms = Some(now);
            }
            if matches!(next_status, JobStatus::Running) {
                stored.job.next_eligible_at_ms = None;
            }
            if matches!(next_status, JobStatus::Cancelled) {
                stored.job.finished_at_ms = Some(now);
            }
            push_event(stored, event(JobActor::User, kind, message, None));
            Ok(stored.job.clone())
        })
    }

    pub fn finish(
        &mut self,
        workspace: &str,
        job_id: &str,
        outcome: JobOutcome,
        summary: Option<String>,
        evidence: JobEvidence,
    ) -> Result<OrchestrationJob, String> {
        let workspace = normalized_text(workspace, 4_000);
        let job_id = valid_job_id(job_id)?;
        self.mutate(|ledger| {
            let stored = find_job_mut(&mut ledger.jobs, &workspace, &job_id)?;
            let now = now_ms();
            let (status, kind, message) = match outcome {
                JobOutcome::Completed if stored.job.status == JobStatus::Running => (
                    JobStatus::Completed,
                    JobEventKind::Completed,
                    "Task completed.",
                ),
                JobOutcome::Failed if stored.job.status == JobStatus::Running => {
                    (JobStatus::Failed, JobEventKind::Failed, "Task failed.")
                }
                JobOutcome::Cancelled
                    if matches!(stored.job.status, JobStatus::Running | JobStatus::Cancelled) =>
                {
                    (
                        JobStatus::Cancelled,
                        JobEventKind::Cancelled,
                        "Task cancelled.",
                    )
                }
                _ => {
                    return Err(format!(
                        "Cannot finish task {} as {outcome:?} while it is {:?}",
                        stored.job.id, stored.job.status
                    ));
                }
            };
            stored.job.status = status;
            stored.job.updated_at_ms = now;
            stored.job.finished_at_ms = Some(now);
            stored.job.summary = summary
                .as_deref()
                .map(|value| audit_text(value, MAX_SUMMARY_CHARS))
                .filter(|value| !value.is_empty());
            stored.job.evidence.duration_ms = evidence.duration_ms;
            stored.job.evidence.timed_out = evidence.timed_out;
            stored.job.evidence.tool_call_count = stored
                .job
                .evidence
                .tool_call_count
                .max(evidence.tool_call_count);
            stored.job.evidence.failed_tool_call_count = stored
                .job
                .evidence
                .failed_tool_call_count
                .max(evidence.failed_tool_call_count);
            stored.job.evidence.event_count =
                (stored.events.len() as u32).max(evidence.event_count);
            stored.job.evidence = normalize_evidence(stored.job.evidence.clone());
            push_event(
                stored,
                event(
                    JobActor::Agent,
                    kind,
                    message,
                    Some(stored.job.evidence.clone()),
                ),
            );
            Ok(stored.job.clone())
        })
    }

    pub fn schedule_retry(
        &mut self,
        workspace: &str,
        job_id: &str,
        operation_id: &str,
        delay_ms: u64,
    ) -> Result<OrchestrationJob, String> {
        let workspace = normalized_text(workspace, 4_000);
        let job_id = valid_job_id(job_id)?;
        let operation_id = normalized_text(operation_id, 96);
        if operation_id.is_empty() {
            return Err("A fresh operation ID is required to retry a task".to_string());
        }
        if delay_ms > MAX_RETRY_DELAY_MS {
            return Err("Retry delay exceeds the five-minute local limit".to_string());
        }

        self.mutate(|ledger| {
            if ledger.jobs.iter().any(|candidate| {
                candidate.job.operation_id.as_deref() == Some(operation_id.as_str())
                    || candidate
                        .job
                        .operation_ids
                        .iter()
                        .any(|recorded| recorded == &operation_id)
            }) {
                return Err(
                    "Task retry operation ID is already recorded in the local ledger".to_string(),
                );
            }
            let stored = find_job_mut(&mut ledger.jobs, &workspace, &job_id)?;
            if !matches!(
                stored.job.status,
                JobStatus::Failed | JobStatus::Interrupted
            ) {
                return Err(format!(
                    "Cannot retry task {} while it is {:?}",
                    stored.job.id, stored.job.status
                ));
            }
            if stored.job.attempt >= stored.job.budget.max_attempts {
                return Err(format!(
                    "Task {} exhausted its {} allowed attempts",
                    stored.job.id, stored.job.budget.max_attempts
                ));
            }

            let now = now_ms();
            stored.job.status = JobStatus::Queued;
            stored.job.attempt = stored.job.attempt.saturating_add(1);
            if let Some(previous) = stored.job.operation_id.as_ref() {
                if !stored.job.operation_ids.contains(previous) {
                    stored.job.operation_ids.push(previous.clone());
                }
            }
            stored.job.operation_id = Some(operation_id);
            if let Some(operation_id) = stored.job.operation_id.as_ref() {
                stored.job.operation_ids.push(operation_id.clone());
            }
            stored.job.updated_at_ms = now;
            stored.job.started_at_ms = None;
            stored.job.finished_at_ms = None;
            stored.job.next_eligible_at_ms = Some(now.saturating_add(delay_ms));
            stored.job.summary = None;
            stored.job.evidence = JobEvidence::default();
            let message = if delay_ms == 0 {
                "Retry queued with a fresh operation identity."
            } else {
                "Retry scheduled with a bounded local backoff."
            };
            push_event(
                stored,
                event(JobActor::User, JobEventKind::RetryScheduled, message, None),
            );
            Ok(stored.job.clone())
        })
    }

    pub fn record_verification(
        &mut self,
        workspace: &str,
        job_id: &str,
        check_id: &str,
        command: &str,
        success: bool,
        duration_ms: Option<u64>,
    ) -> Result<OrchestrationJob, String> {
        let workspace = normalized_text(workspace, 4_000);
        let job_id = valid_job_id(job_id)?;
        let check_id = normalized_text(check_id, 128);
        let command = redact_secrets(&normalized_text(command, 1024));

        self.mutate(|ledger| {
            let stored = find_job_mut(&mut ledger.jobs, &workspace, &job_id)?;
            let now = now_ms();
            let status_str = if success { "passed" } else { "failed" };
            let message = format!(
                "Verification check '{}' ({}) {}.",
                check_id, command, status_str
            );

            let mut ev = stored.job.evidence.clone();
            ev.event_count = ev.event_count.saturating_add(1);
            ev.tool_call_count = ev.tool_call_count.saturating_add(1);
            if !success {
                ev.failed_tool_call_count = ev.failed_tool_call_count.saturating_add(1);
            }
            if let Some(dur) = duration_ms {
                ev.duration_ms = Some(ev.duration_ms.unwrap_or(0).saturating_add(dur));
            }
            stored.job.evidence = ev.clone();
            stored.job.updated_at_ms = now;

            push_event(
                stored,
                event(JobActor::User, JobEventKind::Evidence, &message, Some(ev)),
            );
            Ok(stored.job.clone())
        })
    }

    /// Append one deliberately small piece of execution evidence to the task
    /// identified by its globally unique run operation. This is used by the
    /// native harness, rather than the frontend, so an app-window disconnect
    /// cannot make the audit trail claim that no tools were used. The caller
    /// supplies only a curated status label; raw prompts, tool input, and tool
    /// output never enter this store.
    ///
    /// Returning `Ok(false)` is intentional when a run was not started from a
    /// durable Whim task (or it has already finished). Direct agent API users
    /// remain supported without manufacturing an audit record for them.
    pub fn append_agent_evidence_for_operation(
        &mut self,
        operation_id: &str,
        message: &str,
    ) -> Result<bool, String> {
        let operation_id = normalized_text(operation_id, 96);
        let message = audit_text(message, MAX_SUMMARY_CHARS);
        if operation_id.is_empty() || message.is_empty() {
            return Ok(false);
        }

        self.mutate(|ledger| {
            let Some(stored) = ledger
                .jobs
                .iter_mut()
                .find(|stored| stored.job.operation_id.as_deref() == Some(operation_id.as_str()))
            else {
                return Ok(false);
            };
            // A cancelled, interrupted, or completed job must not gain new
            // agent evidence later. This prevents late process output from
            // rewriting the historical record after a user stop/restart.
            if stored.job.status != JobStatus::Running {
                return Ok(false);
            }

            stored.job.updated_at_ms = now_ms();
            if message.starts_with("Completed: ") {
                stored.job.evidence.tool_call_count =
                    stored.job.evidence.tool_call_count.saturating_add(1);
            } else if message.starts_with("Tool failed: ") {
                stored.job.evidence.tool_call_count =
                    stored.job.evidence.tool_call_count.saturating_add(1);
                stored.job.evidence.failed_tool_call_count =
                    stored.job.evidence.failed_tool_call_count.saturating_add(1);
            }
            push_event(
                stored,
                event(JobActor::Agent, JobEventKind::Evidence, &message, None),
            );
            stored.job.evidence.event_count = stored.events.len() as u32;
            Ok(true)
        })
    }

    fn mutate<T>(
        &mut self,
        action: impl FnOnce(&mut Ledger) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut ledger = self.load()?;
        if !self.recovered_current_process {
            recover_interrupted_jobs(&mut ledger);
            self.recovered_current_process = true;
        }
        let output = action(&mut ledger)?;
        self.save(&ledger)?;
        Ok(output)
    }

    fn load(&self) -> Result<Ledger, String> {
        if !self.path.exists() {
            return Ok(Ledger {
                version: LEDGER_VERSION,
                jobs: Vec::new(),
            });
        }
        let bytes = fs::read(&self.path).map_err(|error| {
            format!(
                "Could not read task ledger {}: {error}",
                self.path.display()
            )
        })?;
        let ledger: Ledger = serde_json::from_slice(&bytes).map_err(|error| {
            format!(
                "Task ledger {} is not valid JSON; it was left unchanged for recovery: {error}",
                self.path.display()
            )
        })?;
        if ledger.version > LEDGER_VERSION {
            return Err(format!(
                "Task ledger {} was created by a newer version of Whim",
                self.path.display()
            ));
        }
        Ok(ledger)
    }

    fn save(&self, ledger: &Ledger) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "Task ledger path has no parent directory".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create task ledger directory {}: {error}",
                parent.display()
            )
        })?;
        let encoded = serde_json::to_vec_pretty(ledger)
            .map_err(|error| format!("Could not serialize task ledger: {error}"))?;
        let temporary = self
            .path
            .with_extension(format!("{}.tmp", Uuid::new_v4().simple()));
        {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| format!("Could not create task ledger temporary file: {error}"))?;
            file.write_all(&encoded)
                .map_err(|error| format!("Could not write task ledger: {error}"))?;
            file.write_all(b"\n")
                .map_err(|error| format!("Could not finish task ledger write: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("Could not sync task ledger: {error}"))?;
        }
        // Keep a last-known-good copy. If a machine loses power during a replace,
        // the user can recover it manually without Whim silently dropping audit data.
        if self.path.exists() {
            let backup = self.path.with_extension("json.bak");
            fs::copy(&self.path, backup)
                .map_err(|error| format!("Could not back up task ledger: {error}"))?;
        }
        fs::rename(&temporary, &self.path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!(
                "Could not replace task ledger {}: {error}",
                self.path.display()
            )
        })
    }
}

fn default_store_path() -> PathBuf {
    let base = env::var_os("WHIM_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .or_else(|| env::var_os("APPDATA").map(PathBuf::from))
        .or_else(|| {
            env::var_os("USERPROFILE")
                .map(|value| PathBuf::from(value).join("AppData").join("Local"))
        })
        .or_else(|| {
            env::var_os("HOME").map(|value| PathBuf::from(value).join(".local").join("state"))
        })
        .unwrap_or_else(env::temp_dir);
    base.join("Whim IDE")
        .join("orchestration")
        .join("jobs.json")
}

fn valid_job_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    Uuid::parse_str(value)
        .map_err(|_| "Task ID is invalid".to_string())
        .map(|_| value.to_string())
}

fn find_job<'a>(
    jobs: &'a [StoredJob],
    workspace: &str,
    job_id: &str,
) -> Result<&'a StoredJob, String> {
    jobs.iter()
        .find(|stored| stored.job.workspace == workspace && stored.job.id == job_id)
        .ok_or_else(|| "Task not found in the selected workspace".to_string())
}

fn find_job_mut<'a>(
    jobs: &'a mut [StoredJob],
    workspace: &str,
    job_id: &str,
) -> Result<&'a mut StoredJob, String> {
    jobs.iter_mut()
        .find(|stored| stored.job.workspace == workspace && stored.job.id == job_id)
        .ok_or_else(|| "Task not found in the selected workspace".to_string())
}

fn recover_interrupted_jobs(ledger: &mut Ledger) -> bool {
    let now = now_ms();
    let mut changed = false;
    for stored in &mut ledger.jobs {
        if stored.job.status == JobStatus::Running {
            stored.job.status = JobStatus::Interrupted;
            stored.job.updated_at_ms = now;
            push_event(
                stored,
                event(
                    JobActor::System,
                    JobEventKind::Interrupted,
                    "Whim restarted before this task finished. Its history is preserved; start a new run to continue.",
                    None,
                ),
            );
            changed = true;
        }
    }
    changed
}

fn push_event(stored: &mut StoredJob, event: OrchestrationEvent) {
    stored.events.push(event);
    if stored.events.len() > MAX_EVENTS_PER_JOB {
        let excess = stored.events.len() - MAX_EVENTS_PER_JOB;
        stored.events.drain(..excess);
    }
    stored.job.event_count = stored.events.len();
}

fn trim_ledger(ledger: &mut Ledger) {
    if ledger.jobs.len() <= MAX_JOBS {
        return;
    }
    ledger.jobs.sort_by_key(|left| left.job.updated_at_ms);
    while ledger.jobs.len() > MAX_JOBS {
        if let Some(index) = ledger
            .jobs
            .iter()
            .position(|stored| !stored.job.status.is_active())
        {
            ledger.jobs.remove(index);
        } else {
            break;
        }
    }
}

fn event(
    actor: JobActor,
    kind: JobEventKind,
    message: &str,
    evidence: Option<JobEvidence>,
) -> OrchestrationEvent {
    OrchestrationEvent {
        id: Uuid::new_v4().to_string(),
        at_ms: now_ms(),
        actor,
        kind,
        message: audit_text(message, MAX_SUMMARY_CHARS),
        evidence,
    }
}

fn normalize_evidence(mut evidence: JobEvidence) -> JobEvidence {
    evidence.event_count = evidence.event_count.min(10_000);
    evidence.tool_call_count = evidence.tool_call_count.min(10_000);
    evidence.failed_tool_call_count = evidence
        .failed_tool_call_count
        .min(evidence.tool_call_count);
    evidence.duration_ms = evidence
        .duration_ms
        .map(|value| value.min(MAX_JOB_TIMEOUT_MS));
    evidence
}

fn title_from_intent(intent: &str) -> String {
    let candidate = intent
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        })
        .unwrap_or("Whim task");
    let value = normalized_text(candidate, MAX_TITLE_CHARS);
    if value.is_empty() {
        "Whim task".to_string()
    } else {
        value
    }
}

fn normalized_text(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\t'))
        .take(limit)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Redact obvious assignment-style secrets before persisting user-provided
/// intent. It intentionally errs toward redaction; the original text still
/// remains in the current UI session, but not in the durable audit ledger.
pub(crate) fn audit_text(value: &str, limit: usize) -> String {
    let cleaned = normalized_text(value, limit.saturating_mul(2));
    let redacted = cleaned
        .lines()
        .map(redact_assignment_line)
        .collect::<Vec<_>>()
        .join("\n");
    normalized_text(&redacted, limit)
}

fn redact_assignment_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let has_secret_label = [
        "api_key",
        "api-key",
        "apikey",
        "access_token",
        "token",
        "password",
        "secret",
        "authorization",
    ]
    .iter()
    .any(|label| lower.contains(label));
    let separator = line.find('=').or_else(|| line.find(':'));
    if has_secret_label && separator.is_some() {
        let index = separator.unwrap_or_default();
        return format!("{} [redacted]", line[..=index].trim_end());
    }
    if let Some(index) = lower.find("bearer ") {
        return format!("{}Bearer [redacted]", &line[..index]);
    }
    line.to_string()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store(name: &str) -> (DurableJobStore, PathBuf) {
        let directory =
            env::temp_dir().join(format!("whim_orchestrator_{name}_{}", Uuid::new_v4()));
        let path = directory.join("jobs.json");
        (DurableJobStore::at(path), directory)
    }

    fn create_input(workspace: &str) -> CreateJobInput {
        CreateJobInput {
            workspace: workspace.to_string(),
            intent: "Improve the project task ledger".to_string(),
            title: None,
            mode: JobMode::Build,
            operation_id: Some(Uuid::new_v4().to_string()),
            provider: Some("local".to_string()),
            model: Some("test-model".to_string()),
            max_duration_ms: Some(10),
        }
    }

    #[test]
    fn redacts_assignment_style_secrets() {
        let redacted = audit_text("OPENAI_API_KEY=sk-top-secret\nKeep the visual editor", 400);
        assert!(redacted.contains("OPENAI_API_KEY= [redacted]"));
        assert!(!redacted.contains("sk-top-secret"));
        assert!(redacted.contains("Keep the visual editor"));
    }

    #[test]
    fn task_state_survives_reload_and_recovers_running_work() {
        let (mut store, directory) = test_store("recovery");
        let workspace = "C:/example";
        let created = store.create(create_input(workspace)).unwrap();
        let running = store
            .transition(workspace, &created.id, JobAction::Start)
            .unwrap();
        assert_eq!(running.status, JobStatus::Running);
        assert_eq!(running.budget.max_duration_ms, MIN_JOB_TIMEOUT_MS);

        let mut reloaded = DurableJobStore::at(store.storage_path().to_path_buf());
        let jobs = reloaded.list_for_workspace(workspace).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].status, JobStatus::Interrupted);
        let detail = reloaded.detail(workspace, &created.id).unwrap();
        assert!(detail
            .events
            .iter()
            .any(|event| event.kind == JobEventKind::Interrupted));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn task_transitions_and_evidence_are_constrained() {
        let (mut store, directory) = test_store("transition");
        let workspace = "C:/example";
        let created = store.create(create_input(workspace)).unwrap();
        assert!(store
            .finish(
                workspace,
                &created.id,
                JobOutcome::Completed,
                Some("Should not finish while queued".to_string()),
                JobEvidence::default(),
            )
            .is_err());
        store
            .transition(workspace, &created.id, JobAction::Start)
            .unwrap();
        let finished = store
            .finish(
                workspace,
                &created.id,
                JobOutcome::Completed,
                Some("Verification completed".to_string()),
                JobEvidence {
                    event_count: 4,
                    tool_call_count: 2,
                    failed_tool_call_count: 0,
                    duration_ms: Some(500),
                    timed_out: false,
                },
            )
            .unwrap();
        assert_eq!(finished.status, JobStatus::Completed);
        assert_eq!(finished.evidence.tool_call_count, 2);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn native_tool_evidence_is_bound_to_the_running_operation() {
        let (mut store, directory) = test_store("tool-evidence");
        let workspace = "C:/example";
        let created = store.create(create_input(workspace)).unwrap();
        let operation_id = created.operation_id.clone().expect("operation id");
        let mut duplicate = create_input(workspace);
        duplicate.operation_id = Some(operation_id.clone());
        assert!(store.create(duplicate).is_err());

        // Evidence cannot be attached before the user starts the task.
        assert!(!store
            .append_agent_evidence_for_operation(&operation_id, "Completed: Read.")
            .unwrap());
        store
            .transition(workspace, &created.id, JobAction::Start)
            .unwrap();
        assert!(store
            .append_agent_evidence_for_operation(
                &operation_id,
                "Completed: Write. OPENAI_API_KEY=never-store-this",
            )
            .unwrap());

        let detail = store.detail(workspace, &created.id).unwrap();
        let evidence = detail
            .events
            .iter()
            .find(|event| event.kind == JobEventKind::Evidence)
            .expect("durable evidence event");
        assert_eq!(evidence.actor, JobActor::Agent);
        assert!(evidence.message.contains("Completed: Write."));
        assert!(!evidence.message.contains("never-store-this"));

        assert!(!store
            .append_agent_evidence_for_operation("other-operation", "Completed: Read.")
            .unwrap());
        store
            .finish(
                workspace,
                &created.id,
                JobOutcome::Completed,
                None,
                JobEvidence::default(),
            )
            .unwrap();
        assert!(!store
            .append_agent_evidence_for_operation(&operation_id, "Completed: Read.")
            .unwrap());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn scheduler_leases_one_fifo_writer_slot_per_execution_target() {
        let (mut store, directory) = test_store("scheduler-slot");
        let target = "C:/example/worktree-a";
        let other_target = "C:/example/worktree-b";
        let first = store.create(create_input(target)).unwrap();
        let second = store.create(create_input(target)).unwrap();
        let parallel = store.create(create_input(other_target)).unwrap();

        let early_start = store.transition(target, &second.id, JobAction::Start);
        assert!(early_start
            .unwrap_err()
            .contains("earlier queued task owns the next execution slot"));

        store
            .transition(target, &first.id, JobAction::Start)
            .unwrap();
        let blocked = store.transition(target, &second.id, JobAction::Start);
        assert!(blocked.unwrap_err().contains(&first.id));
        assert_eq!(
            store.detail(target, &second.id).unwrap().job.status,
            JobStatus::Queued
        );

        // A registered isolated worktree is an independent execution target,
        // so its writer can run in parallel without sharing the lease.
        assert_eq!(
            store
                .transition(other_target, &parallel.id, JobAction::Start)
                .unwrap()
                .status,
            JobStatus::Running
        );

        store
            .finish(
                target,
                &first.id,
                JobOutcome::Completed,
                None,
                JobEvidence::default(),
            )
            .unwrap();
        assert_eq!(
            store
                .transition(target, &second.id, JobAction::Start)
                .unwrap()
                .status,
            JobStatus::Running
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn read_only_research_jobs_run_beside_the_workspace_writer() {
        let (mut store, directory) = test_store("research-parallel");
        let workspace = "C:/example/worktree-a";
        let writer = store.create(create_input(workspace)).unwrap();
        store
            .transition(workspace, &writer.id, JobAction::Start)
            .unwrap();

        let mut research_input = create_input(workspace);
        research_input.mode = JobMode::Research;
        research_input.title = Some("Read-only research".into());
        let research = store.create(research_input).unwrap();
        let running = store
            .transition(workspace, &research.id, JobAction::Start)
            .unwrap();

        assert_eq!(running.status, JobStatus::Running);
        assert_eq!(running.risk, JobRisk::Low);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn project_roster_lists_only_explicit_execution_targets() {
        let (mut store, directory) = test_store("project-roster");
        let primary = "C:/example/main";
        let linked = "C:/example/review";
        let unrelated = "C:/other/repository";
        store.create(create_input(primary)).unwrap();
        store.create(create_input(linked)).unwrap();
        store.create(create_input(unrelated)).unwrap();

        let roster = store
            .list_for_workspaces(&[primary.to_string(), linked.to_string()])
            .unwrap();
        assert_eq!(roster.len(), 2);
        assert!(roster.iter().all(|job| job.workspace != unrelated));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn retries_require_fresh_identity_and_stop_at_the_attempt_budget() {
        let (mut store, directory) = test_store("retry-budget");
        let workspace = "C:/example";
        let created = store.create(create_input(workspace)).unwrap();
        store
            .transition(workspace, &created.id, JobAction::Start)
            .unwrap();
        store
            .finish(
                workspace,
                &created.id,
                JobOutcome::Failed,
                Some("First attempt failed".to_string()),
                JobEvidence::default(),
            )
            .unwrap();

        let second_operation = Uuid::new_v4().to_string();
        let second = store
            .schedule_retry(workspace, &created.id, &second_operation, 0)
            .unwrap();
        assert_eq!(second.status, JobStatus::Queued);
        assert_eq!(second.attempt, 2);
        assert_eq!(
            second.operation_id.as_deref(),
            Some(second_operation.as_str())
        );
        assert!(store
            .schedule_retry(workspace, &created.id, &second_operation, 0)
            .is_err());
        assert!(store
            .schedule_retry(
                workspace,
                &created.id,
                created.operation_id.as_deref().unwrap(),
                0,
            )
            .is_err());

        store
            .transition(workspace, &created.id, JobAction::Start)
            .unwrap();
        store
            .finish(
                workspace,
                &created.id,
                JobOutcome::Failed,
                None,
                JobEvidence::default(),
            )
            .unwrap();
        store
            .schedule_retry(workspace, &created.id, &Uuid::new_v4().to_string(), 0)
            .unwrap();
        store
            .transition(workspace, &created.id, JobAction::Start)
            .unwrap();
        store
            .finish(
                workspace,
                &created.id,
                JobOutcome::Failed,
                None,
                JobEvidence::default(),
            )
            .unwrap();

        let exhausted =
            store.schedule_retry(workspace, &created.id, &Uuid::new_v4().to_string(), 0);
        assert!(exhausted
            .unwrap_err()
            .contains("exhausted its 3 allowed attempts"));
        let detail = store.detail(workspace, &created.id).unwrap();
        assert_eq!(detail.job.attempt, 3);
        assert_eq!(
            detail
                .events
                .iter()
                .filter(|event| event.kind == JobEventKind::RetryScheduled)
                .count(),
            2
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn older_ledgers_receive_safe_retry_defaults() {
        let (mut store, directory) = test_store("retry-migration");
        let workspace = "C:/example";
        let created = store.create(create_input(workspace)).unwrap();
        let path = store.storage_path().to_path_buf();
        let mut ledger: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let job = ledger["jobs"][0]["job"].as_object_mut().unwrap();
        job.remove("attempt");
        job.remove("nextEligibleAtMs");
        job["budget"].as_object_mut().unwrap().remove("maxAttempts");
        fs::write(&path, serde_json::to_vec_pretty(&ledger).unwrap()).unwrap();

        let mut reloaded = DurableJobStore::at(path);
        let migrated = reloaded.detail(workspace, &created.id).unwrap().job;
        assert_eq!(migrated.attempt, 1);
        assert_eq!(migrated.budget.max_attempts, DEFAULT_MAX_ATTEMPTS);
        assert_eq!(migrated.next_eligible_at_ms, None);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn verification_records_evidence_events_and_updates_job_metadata() {
        let (mut store, directory) = test_store("verification-evidence");
        let workspace = "C:/example";
        let created = store.create(create_input(workspace)).unwrap();

        store
            .transition(workspace, &created.id, JobAction::Start)
            .unwrap();

        let updated = store
            .record_verification(
                workspace,
                &created.id,
                "node-lint",
                "npm run lint",
                true,
                Some(150),
            )
            .unwrap();

        assert_eq!(updated.evidence.event_count, 1);
        assert_eq!(updated.evidence.tool_call_count, 1);
        assert_eq!(updated.evidence.failed_tool_call_count, 0);
        assert_eq!(updated.evidence.duration_ms, Some(150));

        let detail = store.detail(workspace, &created.id).unwrap();
        let evidence_event = detail
            .events
            .iter()
            .find(|event| event.kind == JobEventKind::Evidence)
            .expect("durable evidence event");
        assert_eq!(evidence_event.actor, JobActor::User);
        assert!(evidence_event
            .message
            .contains("Verification check 'node-lint' (npm run lint) passed."));

        // Record a failure check
        let updated2 = store
            .record_verification(
                workspace,
                &created.id,
                "node-test",
                "npm run test",
                false,
                Some(500),
            )
            .unwrap();
        assert_eq!(updated2.evidence.event_count, 2);
        assert_eq!(updated2.evidence.tool_call_count, 2);
        assert_eq!(updated2.evidence.failed_tool_call_count, 1);
        assert_eq!(updated2.evidence.duration_ms, Some(650));

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn verification_command_secrets_are_redacted_in_durable_ledger() {
        let (mut store, directory) = test_store("verification-redaction");
        let workspace = "C:/example";
        let created = store.create(create_input(workspace)).unwrap();
        store
            .transition(workspace, &created.id, JobAction::Start)
            .unwrap();

        // A verification command that embeds a secret must not persist the
        // secret to the durable on-disk ledger in cleartext. The orchestrator
        // documents that it must never become another secret store.
        let secret_command =
            "curl -H \"Authorization: Bearer ya29.abcdefghijklmnopqrstuvwxyz0123456789\" https://api.example.com/check";
        store
            .record_verification(
                workspace,
                &created.id,
                "health",
                secret_command,
                true,
                Some(120),
            )
            .unwrap();

        let detail = store.detail(workspace, &created.id).unwrap();
        let evidence_event = detail
            .events
            .iter()
            .find(|event| event.kind == JobEventKind::Evidence)
            .expect("durable evidence event");
        assert!(
            !evidence_event
                .message
                .contains("ya29.abcdefghijklmnopqrstuvwxyz0123456789"),
            "verification command secret must be redacted in durable ledger: {}",
            evidence_event.message
        );
        assert!(
            evidence_event.message.contains("[redacted]"),
            "redaction marker expected in durable evidence: {}",
            evidence_event.message
        );

        let _ = fs::remove_dir_all(directory);
    }
}

// ─── Multi-agent orchestration types ─────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubTaskStatus {
    Pending,
    Ready,
    Running,
    Completed,
    Failed,
    Cancelled,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubTask {
    pub id: String,
    pub parent_job_id: String,
    pub description: String,
    #[serde(default)]
    pub deps: Vec<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub status: SubTaskStatus,
    pub attempt: u32,
    pub max_attempts: u32,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub started_at_ms: Option<u64>,
    pub finished_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubTaskEvent {
    pub sub_task_id: String,
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPoolEntry {
    pub provider: String,
    pub model: String,
    pub label: String,
    pub status: String, // "available" | "busy" | "rate_limited" | "degraded"
    pub busy_since_ms: Option<u64>,
    pub consecutive_failures: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestrationPoolStatus {
    pub entries: Vec<ProviderPoolEntry>,
    pub active_sub_tasks: u32,
    pub queued_sub_tasks: u32,
    pub total_providers: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentJobRequest {
    pub workspace: String,
    pub intent: String,
    pub title: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

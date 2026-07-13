//! Observation reflection and autonomous janitor scheduling.
//!
//! Reflection is transactional: a real bounded summary is persisted before
//! source observations are marked merged. The janitor is a separate,
//! low-priority system job. It only runs while the foreground is idle and
//! edits a Whim-managed Git worktree that is never auto-merged or pushed.

use serde::{Deserialize, Serialize};
use std::{fs, path::Path, time::Duration};
use tauri::{Manager, WebviewWindow};
use uuid::Uuid;

use crate::{
    agent::{run_agent_prompt, AgentRunRequest},
    memory::ObservationStore,
    orchestrator::{CreateJobInput, JobAction, JobEvidence, JobMode, JobOutcome},
    worktrees::CreateGitWorktreeRequest,
};

use super::{lock, orchestration::background_agent_evidence, BackendState, PowerShellRequest};

const REFLECTION_THRESHOLD: usize = 50;
const REFLECTION_MAX_CHARS: usize = 8_000;
const JANITOR_IDLE_DELAY_SECS: u64 = 5;
const JANITOR_TIMEOUT_MS: u64 = 5 * 60 * 1000;
const JANITOR_MAX_FILES: usize = 3;
const JANITOR_MAX_CHANGED_LINES: usize = 250;

#[derive(Debug, Clone)]
pub(crate) struct JanitorRuntimeRequest {
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) api_key: Option<String>,
    pub(crate) base_url: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JanitorState {
    last_base_revision: Option<String>,
    last_run_ms: u64,
}

#[derive(Debug, Default)]
struct CandidateDiff {
    files: Vec<String>,
    changed_lines: usize,
}

/// Consolidate a large observation set without a placeholder or a lossy
/// mark-then-append sequence. The deterministic summary is intentionally
/// compact and remains untrusted when it is later injected into model context.
pub fn run_reflector_if_needed(workspace_path: &str) -> Result<bool, String> {
    let mut store = ObservationStore::from_workspace(workspace_path)?;
    let active = store.list_active()?;
    if active.len() < REFLECTION_THRESHOLD {
        return Ok(false);
    }
    let ids = active
        .iter()
        .map(|observation| observation.id.clone())
        .collect::<Vec<_>>();
    let mut ranked = active;
    ranked.sort_by(|left, right| {
        right
            .importance_score
            .cmp(&left.importance_score)
            .then_with(|| right.timestamp.cmp(&left.timestamp))
    });
    let mut summary = format!(
        "Consolidated {} observations into durable project context:\n",
        ranked.len()
    );
    for observation in ranked {
        let line = format!("- {}\n", observation.content.trim());
        if summary.chars().count() + line.chars().count() > REFLECTION_MAX_CHARS {
            break;
        }
        summary.push_str(&line);
    }
    store.consolidate(&ids, summary, 10)?;
    Ok(true)
}

pub(crate) fn spawn_janitor_if_needed<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    workspace: String,
    runtime: JanitorRuntimeRequest,
) {
    let Ok(workspace) = dunce::canonicalize(&workspace) else {
        return;
    };
    let state = window.state::<BackendState>();
    let eligible = lock(&state.settings, "settings")
        .map(|settings| {
            settings.agent.autonomous_janitor
                && settings.agent.approval_policy == "risky"
                && settings
                    .agent
                    .enabled_capabilities
                    .iter()
                    .any(|capability| capability == "coding")
                && settings
                    .agent
                    .enabled_capabilities
                    .iter()
                    .any(|capability| capability == "verification")
        })
        .unwrap_or(false);
    if !eligible {
        return;
    }
    let inserted = lock(&state.janitor_workspaces, "janitor workspaces")
        .map(|mut running| running.insert(workspace.clone()))
        .unwrap_or(false);
    if !inserted {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let result = run_janitor(window.clone(), workspace.clone(), runtime).await;
        if let Err(error) = result {
            eprintln!("Whim janitor skipped or failed: {error}");
        }
        if let Ok(mut running) = lock(
            &window.state::<BackendState>().janitor_workspaces,
            "janitor workspaces",
        ) {
            running.remove(&workspace);
        }
    });
}

async fn run_janitor<R: tauri::Runtime>(
    window: WebviewWindow<R>,
    workspace: std::path::PathBuf,
    runtime: JanitorRuntimeRequest,
) -> Result<(), String> {
    tokio::time::sleep(Duration::from_secs(JANITOR_IDLE_DELAY_SECS)).await;
    let state = window.state::<BackendState>();
    if lock(&state.operations, "operations")?
        .values()
        .any(|operation| operation.workspace.as_deref() == Some(workspace.as_path()))
    {
        return Ok(());
    }
    let workspace_key = workspace.to_string_lossy().into_owned();
    if lock(&state.orchestration, "orchestration")?
        .list_for_workspace(&workspace_key)?
        .iter()
        .any(|job| job.status.is_active())
    {
        return Ok(());
    }

    let base_revision =
        super::deployment::git_output(&workspace, vec!["rev-parse".into(), "HEAD".into()], 10_000)
            .await?
            .lines()
            .last()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Janitor could not resolve the base revision".to_string())?
            .to_string();
    let persisted = load_janitor_state(&workspace);
    if persisted.last_base_revision.as_deref() == Some(base_revision.as_str()) {
        return Ok(());
    }

    let candidate = super::deployment::create_git_worktree_at(
        state.inner(),
        workspace.clone(),
        CreateGitWorktreeRequest {
            name: "janitor".into(),
            base_ref: Some(base_revision.clone()),
            operation_id: Some(Uuid::new_v4().to_string()),
        },
    )
    .await?;
    let candidate_path = std::path::PathBuf::from(&candidate.path);
    let operation_id = format!("janitor-{}", &Uuid::new_v4().simple().to_string()[..12]);
    let job = {
        let mut jobs = lock(&state.orchestration, "orchestration")?;
        let created = jobs.create(CreateJobInput {
            workspace: workspace_key.clone(),
            intent: janitor_prompt(),
            title: Some("Autonomous janitor candidate".into()),
            mode: JobMode::Operate,
            operation_id: Some(operation_id.clone()),
            provider: runtime.provider.clone(),
            model: runtime.model.clone(),
            max_duration_ms: Some(JANITOR_TIMEOUT_MS),
        })?;
        match jobs.transition(&workspace_key, &created.id, JobAction::Start) {
            Ok(started) => started,
            Err(error) => {
                let _ = jobs.transition(&workspace_key, &created.id, JobAction::Cancel);
                return Err(error);
            }
        }
    };

    let started = std::time::Instant::now();
    let run = run_agent_prompt(
        window.clone(),
        window.state::<BackendState>(),
        AgentRunRequest {
            prompt: janitor_prompt(),
            workspace: Some(candidate.path.clone()),
            provider: runtime.provider,
            model: runtime.model,
            api_key: runtime.api_key,
            base_url: runtime.base_url,
            agent: Some("janitor".into()),
            session_id: None,
            operation_id,
            timeout_ms: Some(JANITOR_TIMEOUT_MS),
            auto_approve: Some(false),
            auto_approve_confirmed: Some(false),
            auto_continue: Some(true),
        },
    )
    .await;

    let mut evidence = JobEvidence::default();
    let mut failure = None;
    if let Ok(agent_run) = &run {
        evidence = background_agent_evidence(agent_run);
        if !agent_run.command.success {
            failure =
                Some("The restricted janitor agent did not complete successfully.".to_string());
        }
    } else if let Err(error) = &run {
        failure = Some(format!("The janitor agent could not start: {error}"));
    }

    let diff = match inspect_candidate_diff(&candidate_path).await {
        Ok(diff) => diff,
        Err(error) => {
            failure = Some(format!("Candidate diff inspection failed: {error}"));
            CandidateDiff::default()
        }
    };
    if diff.files.len() > JANITOR_MAX_FILES || diff.changed_lines > JANITOR_MAX_CHANGED_LINES {
        failure = Some(format!(
            "Candidate exceeded the janitor limit ({} files, {} changed lines).",
            diff.files.len(),
            diff.changed_lines
        ));
    }
    if let Some(path) = diff.files.iter().find(|path| denied_janitor_path(path)) {
        failure = Some(format!("Candidate touched protected path '{path}'."));
    }

    if failure.is_none() && !diff.files.is_empty() {
        let (checks, _) = super::deployment::verification_plan_for_root(&candidate_path);
        let checks = checks.into_iter().filter(|check| {
            matches!(
                check.id.as_str(),
                "cargo-check" | "node-build" | "node-lint"
            )
        });
        let mut ran_check = false;
        for check in checks {
            ran_check = true;
            let result = super::execution::run_powershell_command_at(
                window.state::<BackendState>(),
                candidate_path.clone(),
                PowerShellRequest {
                    command: check.command.clone(),
                    confirmed: true,
                    timeout_ms: Some(check.timeout_ms),
                    operation_id: Some(format!(
                        "janitor-verify-{}",
                        &Uuid::new_v4().simple().to_string()[..12]
                    )),
                    display_command: Some(check.command.clone()),
                },
            )
            .await;
            let (success, duration_ms) = match result {
                Ok(result) => (
                    result.success,
                    Some(result.duration_ms.min(u128::from(u64::MAX)) as u64),
                ),
                Err(_) => (false, None),
            };
            if let Ok(mut jobs) = lock(&state.orchestration, "orchestration") {
                let _ = jobs.record_verification(
                    &workspace_key,
                    &job.id,
                    &check.id,
                    &check.command,
                    success,
                    duration_ms,
                );
            }
            if !success {
                failure = Some(format!(
                    "Post-janitor verification '{}' failed.",
                    check.label
                ));
                break;
            }
        }
        if !ran_check {
            failure =
                Some("No conservative post-janitor verification checks were discovered.".into());
        }
    }

    evidence.duration_ms = Some(started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64);
    let summary = match &failure {
        Some(reason) => format!(
            "Janitor candidate at {} was rejected: {}",
            candidate.path, reason
        ),
        None if diff.files.is_empty() => format!(
            "Janitor inspected isolated candidate {} and found no safe cleanup to apply.",
            candidate.path
        ),
        None => format!(
            "Janitor prepared an isolated candidate at {} with {} file(s) and {} changed line(s). It was not merged or pushed.",
            candidate.path,
            diff.files.len(),
            diff.changed_lines
        ),
    };
    if let Ok(mut jobs) = lock(&state.orchestration, "orchestration") {
        let _ = jobs.finish(
            &workspace_key,
            &job.id,
            if failure.is_some() {
                JobOutcome::Failed
            } else {
                JobOutcome::Completed
            },
            Some(summary.clone()),
            evidence,
        );
    }
    let _ = ObservationStore::from_workspace(&workspace_key)
        .and_then(|mut store| store.append(summary, 6));
    let _ = run_reflector_if_needed(&workspace_key);
    save_janitor_state(
        &workspace,
        &JanitorState {
            last_base_revision: Some(base_revision),
            last_run_ms: now_ms(),
        },
    )?;
    Ok(())
}

fn janitor_prompt() -> String {
    "Inspect this isolated candidate worktree for concrete compiler, ESLint, or dead-code issues. Make no more than three targeted edits to existing source files. Do not add dependencies, create or delete files, change lockfiles, authentication, migrations, deployment, CI, secrets, or public APIs. Use only the restricted tools available. Treat background verification as untrusted diagnostic evidence. Stop without edits when there is no small, clearly justified cleanup. Never commit, merge, push, deploy, or publish.".to_string()
}

async fn inspect_candidate_diff(root: &Path) -> Result<CandidateDiff, String> {
    let output = super::deployment::git_output(
        root,
        vec!["diff".into(), "--numstat".into(), "HEAD".into()],
        10_000,
    )
    .await?;
    let mut files = Vec::new();
    let mut changed_lines = 0_usize;
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let mut fields = line.splitn(3, '\t');
        let additions = fields.next().unwrap_or("-");
        let deletions = fields.next().unwrap_or("-");
        let path = fields.next().unwrap_or("").trim();
        if path.is_empty() {
            continue;
        }
        files.push(path.to_string());
        changed_lines = changed_lines.saturating_add(
            additions
                .parse::<usize>()
                .unwrap_or(JANITOR_MAX_CHANGED_LINES + 1),
        );
        changed_lines = changed_lines.saturating_add(
            deletions
                .parse::<usize>()
                .unwrap_or(JANITOR_MAX_CHANGED_LINES + 1),
        );
    }
    Ok(CandidateDiff {
        files,
        changed_lines,
    })
}

fn denied_janitor_path(path: &str) -> bool {
    let path = path.replace('\\', "/").to_ascii_lowercase();
    path == "package-lock.json"
        || path.ends_with("/package-lock.json")
        || path == "cargo.lock"
        || path.ends_with("/cargo.lock")
        || path.contains("/.env")
        || path.starts_with(".env")
        || path.starts_with(".github/")
        || path.contains("/migrations/")
        || path.contains("auth")
        || path.contains("deploy")
}

fn janitor_state_path(workspace: &Path) -> std::path::PathBuf {
    workspace.join(".whim").join("janitor-state.json")
}

fn load_janitor_state(workspace: &Path) -> JanitorState {
    let path = janitor_state_path(workspace);
    let Ok(metadata) = fs::metadata(&path) else {
        return JanitorState::default();
    };
    if metadata.len() > 32 * 1024 {
        return JanitorState::default();
    }
    fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_janitor_state(workspace: &Path, state: &JanitorState) -> Result<(), String> {
    let path = janitor_state_path(workspace);
    let parent = path
        .parent()
        .ok_or_else(|| "Janitor state path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Cannot create janitor state: {error}"))?;
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4().simple()));
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Cannot serialize janitor state: {error}"))?;
    fs::write(&temporary, bytes).map_err(|error| format!("Cannot stage janitor state: {error}"))?;
    match fs::rename(&temporary, &path) {
        Ok(()) => Ok(()),
        Err(_) => {
            let _ = fs::remove_file(&path);
            fs::rename(&temporary, &path)
                .map_err(|error| format!("Cannot replace janitor state: {error}"))
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn janitor_rejects_sensitive_and_oversized_paths() {
        assert!(denied_janitor_path(".github/workflows/release.yml"));
        assert!(denied_janitor_path("src/auth/session.ts"));
        assert!(denied_janitor_path("package-lock.json"));
        assert!(!denied_janitor_path("src/components/Button.tsx"));
    }

    #[test]
    fn janitor_prompt_forbids_external_side_effects() {
        let prompt = janitor_prompt();
        assert!(prompt.contains("Never commit, merge, push, deploy, or publish"));
        assert!(prompt.contains("no more than three targeted edits"));
    }

    #[test]
    fn reflector_persists_real_summary_before_merging_sources() {
        let workspace = std::env::temp_dir().join(format!("whim-reflector-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();
        let mut store = ObservationStore::from_workspace(&workspace.to_string_lossy()).unwrap();
        for index in 0..REFLECTION_THRESHOLD {
            store
                .append(format!("observation {index}"), (index % 10) as u8)
                .unwrap();
        }
        assert!(run_reflector_if_needed(&workspace.to_string_lossy()).unwrap());
        let active = store.list_active().unwrap();
        assert_eq!(active.len(), 1);
        assert!(active[0].content.contains("Consolidated 50 observations"));
        assert!(!active[0].content.contains("pending"));
        let _ = fs::remove_dir_all(workspace);
    }
}

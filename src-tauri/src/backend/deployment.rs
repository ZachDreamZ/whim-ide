use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    fs,
    net::TcpStream,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::State;
use uuid::Uuid;

use crate::worktrees::{
    is_managed_worktree, managed_worktree_root, parse_worktree_porcelain, validate_git_ref,
    validate_worktree_name, CreateGitWorktreeRequest, GitWorktree,
};

use super::execution::{
    clamp_timeout, execute_tracked, powershell_args, preferred_powershell, quick_capture,
    tool_script, validated_operation_id, CommandResult, ProcessSpec,
};
use super::workspace::selected_workspace_path;
use super::{whim_err, BackendState};
use super::{DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_DEPLOY_TIMEOUT_MS, MAX_DEPLOY_TIMEOUT_MS};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_PACKAGE_JSON_BYTES: u64 = 1_024 * 1_024;
const MAX_CANDIDATE_CHANGES: usize = 500;

// ─── Git helpers ──────────────────────────────────────────────────────────────

pub(crate) async fn git_output(
    root: &Path,
    arguments: Vec<String>,
    timeout_ms: u64,
) -> Result<String, String> {
    let (stdout, stderr, success) =
        quick_capture("git", &arguments, Some(root), timeout_ms).await?;
    if success {
        Ok(stdout)
    } else {
        let detail = stderr.trim();
        Err(if detail.is_empty() {
            "Git did not complete successfully".to_string()
        } else {
            format!("Git did not complete successfully: {detail}")
        })
    }
}

pub(crate) async fn git_repository_root(root: &Path) -> Result<PathBuf, String> {
    let output = git_output(
        root,
        vec!["rev-parse".to_string(), "--show-toplevel".to_string()],
        10_000,
    )
    .await?;
    let path = output
        .lines()
        .last()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Git did not return a repository root".to_string())?;
    dunce::canonicalize(path)
        .map_err(|error| format!("Cannot resolve Git repository root: {error}"))
}

pub(crate) async fn git_worktrees_for_repository(
    repo_root: &Path,
) -> Result<Vec<GitWorktree>, String> {
    let output = git_output(
        repo_root,
        vec![
            "worktree".to_string(),
            "list".to_string(),
            "--porcelain".to_string(),
        ],
        10_000,
    )
    .await?;
    let managed_root = managed_worktree_root(repo_root)?;
    let primary = dunce::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());
    let mut worktrees = parse_worktree_porcelain(&output)
        .into_iter()
        .map(|worktree| {
            let path = dunce::canonicalize(&worktree.path).unwrap_or(worktree.path);
            GitWorktree {
                path: path.to_string_lossy().into_owned(),
                branch: worktree.branch,
                head: worktree.head,
                detached: worktree.detached,
                primary: path == primary,
                managed: is_managed_worktree(&path, &managed_root),
            }
        })
        .collect::<Vec<_>>();
    worktrees.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(worktrees)
}

// ─── Git worktree commands ────────────────────────────────────────────────────

/// List the actual Git worktrees recorded by Git for the selected repository.
/// This is not a local UI cache: Git remains the source of truth across app
/// restarts and external Git clients.
#[tauri::command]
pub async fn list_git_worktrees(
    state: State<'_, BackendState>,
) -> Result<Vec<GitWorktree>, String> {
    let selected = selected_workspace_path(state.inner())?;
    let repo_root = git_repository_root(&selected)
        .await
        .map_err(|error| whim_err("WORKTREE", &error))?;
    git_worktrees_for_repository(&repo_root)
        .await
        .map_err(|error| whim_err("WORKTREE", &error))
}

/// Create a new isolated worktree and branch under a Whim-managed sibling
/// directory. The target location is derived by Whim; callers cannot choose an
/// arbitrary path outside the selected repository's managed worktree root.
#[tauri::command]
pub async fn create_git_worktree(
    state: State<'_, BackendState>,
    request: CreateGitWorktreeRequest,
) -> Result<GitWorktree, String> {
    let selected = selected_workspace_path(state.inner())?;
    create_git_worktree_at(state.inner(), selected, request).await
}

pub(crate) async fn create_git_worktree_at(
    state: &BackendState,
    selected: PathBuf,
    request: CreateGitWorktreeRequest,
) -> Result<GitWorktree, String> {
    let name =
        validate_worktree_name(&request.name).map_err(|error| whim_err("WORKTREE", &error))?;
    let base_ref = request
        .base_ref
        .as_deref()
        .map(validate_git_ref)
        .transpose()
        .map_err(|error| whim_err("WORKTREE", &error))?
        .unwrap_or_else(|| "HEAD".to_string());
    let operation_id = validated_operation_id(request.operation_id)?;
    let repo_root = git_repository_root(&selected)
        .await
        .map_err(|error| whim_err("WORKTREE", &error))?;

    // Resolve the base ref before allocating any directory so failed or stale
    // refs leave no managed filesystem residue behind.
    let base_commit = git_output(
        &repo_root,
        vec![
            "rev-parse".to_string(),
            "--verify".to_string(),
            format!("{base_ref}^{{commit}}"),
        ],
        10_000,
    )
    .await
    .map_err(|error| whim_err("WORKTREE", &format!("Cannot resolve base ref: {error}")))?
    .lines()
    .last()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .ok_or_else(|| whim_err("WORKTREE", "Git did not return a base commit"))?
    .to_string();

    let managed_root =
        managed_worktree_root(&repo_root).map_err(|error| whim_err("WORKTREE", &error))?;
    if managed_root.exists()
        && fs::symlink_metadata(&managed_root)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(true)
    {
        return Err(whim_err(
            "WORKTREE",
            "The managed worktree directory cannot be a symlink",
        ));
    }
    fs::create_dir_all(&managed_root).map_err(|error| {
        whim_err(
            "WORKTREE",
            &format!("Cannot create managed worktree directory: {error}"),
        )
    })?;
    let managed_root = dunce::canonicalize(&managed_root).map_err(|error| {
        whim_err(
            "WORKTREE",
            &format!("Cannot resolve managed worktree directory: {error}"),
        )
    })?;
    let suffix = Uuid::new_v4().simple().to_string()[..8].to_string();
    let target = managed_root.join(format!("{name}-{suffix}"));
    if target.exists() || !target.starts_with(&managed_root) {
        return Err(whim_err(
            "WORKTREE",
            "The managed worktree target is unavailable",
        ));
    }
    let branch = format!("whim/{name}-{suffix}");
    let result = execute_tracked(
        state,
        Some(operation_id),
        "git-worktree",
        ProcessSpec {
            adapter: crate::harness::ExecutionAdapter::NativeWindows,
            program: "git".to_string(),
            args: vec![
                "worktree".to_string(),
                "add".to_string(),
                "-b".to_string(),
                branch.clone(),
                target.to_string_lossy().into_owned(),
                base_commit,
            ],
            display_command: "Git worktree add".to_string(),
            cwd: repo_root.clone(),
            timeout_ms: 5 * 60 * 1000,
            environment: Vec::new(),
            environment_remove: Vec::new(),
        },
    )
    .await
    .map_err(|error| whim_err("WORKTREE", &error))?;
    if !result.success {
        let detail = result.stderr.trim();
        return Err(whim_err(
            "WORKTREE",
            if detail.is_empty() {
                "Git could not create the worktree"
            } else {
                detail
            },
        ));
    }
    let target = dunce::canonicalize(&target).map_err(|error| {
        whim_err(
            "WORKTREE",
            &format!("Git created an unreadable worktree: {error}"),
        )
    })?;
    git_worktrees_for_repository(&repo_root)
        .await
        .map_err(|error| whim_err("WORKTREE", &error))?
        .into_iter()
        .find(|worktree| {
            dunce::canonicalize(&worktree.path)
                .map(|path| path == target)
                .unwrap_or(false)
        })
        .ok_or_else(|| whim_err("WORKTREE", "Git did not report the new worktree"))
}

// ─── Worktree candidate inspection ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectWorktreeCandidateRequest {
    pub candidate_workspace: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CandidateChange {
    pub path: String,
    pub status: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCandidateReport {
    pub base_workspace: String,
    pub candidate_workspace: String,
    pub base_head: String,
    pub candidate_head: String,
    pub merge_base: String,
    pub branch: Option<String>,
    pub committed_change_count: usize,
    pub working_change_count: usize,
    pub changes: Vec<CandidateChange>,
    pub changes_truncated: bool,
    pub risk: String,
    pub risk_signals: Vec<String>,
    pub blockers: Vec<String>,
    pub verification_checks: Vec<VerificationCheck>,
    pub verification_warnings: Vec<String>,
}

pub(crate) fn parse_candidate_changes(
    committed: &str,
    working: &str,
) -> (Vec<CandidateChange>, usize, usize, bool) {
    let mut changes = Vec::new();
    let mut committed_count = 0_usize;
    let mut working_count = 0_usize;
    for line in committed.lines().filter(|line| !line.trim().is_empty()) {
        committed_count = committed_count.saturating_add(1);
        let mut parts = line.split('\t');
        let status = parts.next().unwrap_or("changed").trim();
        let path = parts.next_back().unwrap_or("").trim();
        if !path.is_empty() && changes.len() < MAX_CANDIDATE_CHANGES {
            changes.push(CandidateChange {
                path: path.to_string(),
                status: status.to_string(),
                source: "committed".to_string(),
            });
        }
    }
    for line in working.lines().filter(|line| line.len() >= 3) {
        working_count = working_count.saturating_add(1);
        let status = line.get(..2).unwrap_or("??").trim();
        let raw_path = line.get(3..).unwrap_or("").trim();
        let path = raw_path.rsplit(" -> ").next().unwrap_or(raw_path).trim();
        if !path.is_empty() && changes.len() < MAX_CANDIDATE_CHANGES {
            changes.push(CandidateChange {
                path: path.to_string(),
                status: if status.is_empty() { "changed" } else { status }.to_string(),
                source: "working".to_string(),
            });
        }
    }
    let truncated = committed_count.saturating_add(working_count) > changes.len();
    (changes, committed_count, working_count, truncated)
}

pub(crate) fn candidate_risk(
    changes: &[CandidateChange],
    total_changes: usize,
) -> (String, Vec<String>) {
    let mut signals = BTreeSet::new();
    for change in changes {
        let path = change.path.replace('\\', "/").to_ascii_lowercase();
        if path.contains("migration") || path.contains("schema") {
            signals.insert("Database schema or migration files changed".to_string());
        }
        if path.contains("auth") || path.contains("permission") || path.contains("policy") {
            signals.insert("Authentication or authorization files changed".to_string());
        }
        if path.contains("deploy") || path.contains("docker") || path.contains(".github/workflows")
        {
            signals.insert("Deployment or CI configuration changed".to_string());
        }
        if path.ends_with("package-lock.json")
            || path.ends_with("cargo.lock")
            || path.ends_with("pnpm-lock.yaml")
        {
            signals.insert("Dependency lockfile changed".to_string());
        }
        if path.contains(".env") || path.contains("secret") || path.contains("credential") {
            signals.insert("Sensitive configuration path changed".to_string());
        }
    }
    if total_changes > 25 {
        signals.insert("Broad change set exceeds 25 files".to_string());
    }
    let risk = if signals.iter().any(|signal| {
        signal.contains("Authentication")
            || signal.contains("Sensitive")
            || signal.contains("Database")
    }) {
        "high"
    } else if !signals.is_empty() || total_changes > 10 {
        "medium"
    } else {
        "low"
    };
    (risk.to_string(), signals.into_iter().collect())
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

/// Produce a bounded, read-only comparison between the primary worktree and a
/// Git-registered candidate. This is the lower-level API used by
/// `inspect_worktree_candidate` and directly from tests.
#[allow(dead_code)]
pub(crate) async fn candidate_report_for_paths(
    primary: &Path,
    candidate: &Path,
    branch: Option<String>,
) -> Result<WorktreeCandidateReport, String> {
    let base_head = git_output(primary, vec!["rev-parse".into(), "HEAD".into()], 10_000)
        .await
        .map_err(|e| whim_err("CANDIDATE_REVIEW", &e))?
        .trim()
        .to_string();
    let candidate_head = git_output(candidate, vec!["rev-parse".into(), "HEAD".into()], 10_000)
        .await
        .map_err(|e| whim_err("CANDIDATE_REVIEW", &e))?
        .trim()
        .to_string();
    let merge_base = git_output(
        candidate,
        vec![
            "merge-base".into(),
            base_head.clone(),
            candidate_head.clone(),
        ],
        10_000,
    )
    .await
    .map_err(|e| whim_err("CANDIDATE_REVIEW", &e))?
    .trim()
    .to_string();
    let committed = git_output(
        candidate,
        vec![
            "diff".into(),
            "--name-status".into(),
            "--find-renames".into(),
            merge_base.clone(),
            candidate_head.clone(),
            "--".into(),
        ],
        20_000,
    )
    .await
    .map_err(|e| whim_err("CANDIDATE_REVIEW", &e))?;
    let working = git_output(
        candidate,
        vec![
            "status".into(),
            "--porcelain=v1".into(),
            "--untracked-files=all".into(),
        ],
        20_000,
    )
    .await
    .map_err(|e| whim_err("CANDIDATE_REVIEW", &e))?;
    let (changes, committed_change_count, working_change_count, changes_truncated) =
        parse_candidate_changes(&committed, &working);
    let total_changes = committed_change_count.saturating_add(working_change_count);
    let (risk, risk_signals) = candidate_risk(&changes, total_changes);
    let (verification_checks, verification_warnings) = verification_plan_for_root(candidate);

    let mut blockers = Vec::new();
    if working_change_count > 0 {
        blockers.push(
            "Candidate has uncommitted changes; review and commit or discard them before merge."
                .to_string(),
        );
    }
    if committed_change_count == 0 {
        blockers.push("Candidate has no committed changes relative to its merge base.".to_string());
    }
    if verification_checks.is_empty() {
        blockers
            .push("Whim found no fixed verification entry points for this candidate.".to_string());
    }

    Ok(WorktreeCandidateReport {
        base_workspace: primary.to_string_lossy().into_owned(),
        candidate_workspace: candidate.to_string_lossy().into_owned(),
        base_head,
        candidate_head,
        merge_base,
        branch,
        committed_change_count,
        working_change_count,
        changes,
        changes_truncated,
        risk,
        risk_signals,
        blockers,
        verification_checks,
        verification_warnings,
    })
}

/// Produce a bounded, read-only comparison between the primary worktree and a
/// Git-registered candidate.
#[tauri::command]
pub async fn inspect_worktree_candidate(
    state: State<'_, BackendState>,
    request: InspectWorktreeCandidateRequest,
) -> Result<WorktreeCandidateReport, String> {
    let selected = selected_workspace_path(state.inner())?;
    let repository = git_repository_root(&selected)
        .await
        .map_err(|error| whim_err("CANDIDATE_REVIEW", &error))?;
    let worktrees = git_worktrees_for_repository(&repository)
        .await
        .map_err(|error| whim_err("CANDIDATE_REVIEW", &error))?;
    let primary = worktrees
        .iter()
        .find(|worktree| worktree.primary)
        .ok_or_else(|| whim_err("CANDIDATE_REVIEW", "Git did not report a primary worktree"))?;
    let candidate_path = canonical_workspace(&request.candidate_workspace)
        .map_err(|error| whim_err("CANDIDATE_REVIEW", &error))?;
    let candidate = worktrees
        .iter()
        .find(|worktree| {
            dunce::canonicalize(&worktree.path)
                .map(|path| path == candidate_path)
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            whim_err(
                "CANDIDATE_REVIEW",
                "Candidate is not a registered Git worktree",
            )
        })?;
    let primary_path = dunce::canonicalize(&primary.path).map_err(|error| {
        whim_err(
            "CANDIDATE_REVIEW",
            &format!("Cannot resolve primary worktree: {error}"),
        )
    })?;
    if candidate_path == primary_path {
        return Err(whim_err(
            "CANDIDATE_REVIEW",
            "Choose a non-primary worktree as the candidate",
        ));
    }

    let base_head = git_output(
        &primary_path,
        vec!["rev-parse".into(), "HEAD".into()],
        10_000,
    )
    .await
    .map_err(|error| whim_err("CANDIDATE_REVIEW", &error))?
    .trim()
    .to_string();
    let candidate_head = git_output(
        &candidate_path,
        vec!["rev-parse".into(), "HEAD".into()],
        10_000,
    )
    .await
    .map_err(|error| whim_err("CANDIDATE_REVIEW", &error))?
    .trim()
    .to_string();
    let merge_base = git_output(
        &candidate_path,
        vec![
            "merge-base".into(),
            base_head.clone(),
            candidate_head.clone(),
        ],
        10_000,
    )
    .await
    .map_err(|error| whim_err("CANDIDATE_REVIEW", &error))?
    .trim()
    .to_string();
    let committed = git_output(
        &candidate_path,
        vec![
            "diff".into(),
            "--name-status".into(),
            "--find-renames".into(),
            merge_base.clone(),
            candidate_head.clone(),
            "--".into(),
        ],
        20_000,
    )
    .await
    .map_err(|error| whim_err("CANDIDATE_REVIEW", &error))?;
    let working = git_output(
        &candidate_path,
        vec![
            "status".into(),
            "--porcelain=v1".into(),
            "--untracked-files=all".into(),
        ],
        20_000,
    )
    .await
    .map_err(|error| whim_err("CANDIDATE_REVIEW", &error))?;
    let (changes, committed_change_count, working_change_count, changes_truncated) =
        parse_candidate_changes(&committed, &working);
    let total_changes = committed_change_count.saturating_add(working_change_count);
    let (risk, risk_signals) = candidate_risk(&changes, total_changes);
    let (verification_checks, verification_warnings) = verification_plan_for_root(&candidate_path);
    let mut blockers = Vec::new();
    if working_change_count > 0 {
        blockers.push(
            "Candidate has uncommitted changes; review and commit or discard them before merge."
                .to_string(),
        );
    }
    if committed_change_count == 0 {
        blockers.push("Candidate has no committed changes relative to its merge base.".to_string());
    }
    if verification_checks.is_empty() {
        blockers
            .push("Whim found no fixed verification entry points for this candidate.".to_string());
    }

    Ok(WorktreeCandidateReport {
        base_workspace: primary_path.to_string_lossy().into_owned(),
        candidate_workspace: candidate_path.to_string_lossy().into_owned(),
        base_head,
        candidate_head,
        merge_base,
        branch: candidate.branch.clone(),
        committed_change_count,
        working_change_count,
        changes,
        changes_truncated,
        risk,
        risk_signals,
        blockers,
        verification_checks,
        verification_warnings,
    })
}

// ─── Verification plan ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCheck {
    pub id: String,
    pub label: String,
    pub command: String,
    pub source: String,
    pub tier: String,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationPlan {
    pub workspace: String,
    pub checks: Vec<VerificationCheck>,
    pub warnings: Vec<String>,
}

fn verification_check(
    id: &str,
    label: &str,
    command: &str,
    source: &str,
    tier: &str,
    timeout_ms: u64,
) -> VerificationCheck {
    VerificationCheck {
        id: id.to_string(),
        label: label.to_string(),
        command: command.to_string(),
        source: source.to_string(),
        tier: tier.to_string(),
        timeout_ms,
    }
}

pub(crate) fn verification_plan_for_root(root: &Path) -> (Vec<VerificationCheck>, Vec<String>) {
    let mut checks = Vec::new();
    let mut warnings = Vec::new();
    let package_json = root.join("package.json");
    if package_json.is_file() {
        match fs::metadata(&package_json) {
            Ok(metadata) if metadata.len() > MAX_PACKAGE_JSON_BYTES => warnings.push(format!(
                "package.json exceeds the {} byte inspection limit",
                MAX_PACKAGE_JSON_BYTES
            )),
            Ok(_) => match fs::read_to_string(&package_json)
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            {
                Some(value) => {
                    let scripts = value
                        .get("scripts")
                        .and_then(Value::as_object)
                        .map(|scripts| scripts.keys().cloned().collect::<BTreeSet<_>>())
                        .unwrap_or_default();
                    let runner = if root.join("pnpm-lock.yaml").is_file() {
                        "pnpm run"
                    } else if root.join("yarn.lock").is_file() {
                        "yarn"
                    } else if root.join("bun.lock").is_file() || root.join("bun.lockb").is_file() {
                        "bun run"
                    } else {
                        "npm run"
                    };
                    for (script, label, tier, timeout_ms) in [
                        ("lint", "Lint", "core", 120_000),
                        ("typecheck", "Type check", "core", 180_000),
                        ("check", "Project check", "core", 180_000),
                        ("test", "Tests", "core", 300_000),
                        ("build", "Production build", "core", 300_000),
                        ("test:e2e", "Browser tests", "extended", 600_000),
                    ] {
                        if scripts.contains(script) {
                            checks.push(verification_check(
                                &format!("node-{script}"),
                                label,
                                &format!("{runner} {script}"),
                                "package.json",
                                tier,
                                timeout_ms,
                            ));
                        }
                    }
                }
                None => warnings.push(
                    "package.json could not be parsed; Whim did not infer package scripts."
                        .to_string(),
                ),
            },
            Err(error) => warnings.push(format!("Cannot inspect package.json: {error}")),
        }
    }
    let cargo_manifest = if root.join("Cargo.toml").is_file() {
        Some(("Cargo.toml", None))
    } else if root.join("src-tauri").join("Cargo.toml").is_file() {
        Some(("src-tauri/Cargo.toml", Some("src-tauri/Cargo.toml")))
    } else {
        None
    };
    if let Some((source, manifest_path)) = cargo_manifest {
        let cargo_command = |subcommand: &str, suffix: &str| match manifest_path {
            Some(path) => format!("cargo {subcommand} --manifest-path {path}{suffix}"),
            None => format!("cargo {subcommand}{suffix}"),
        };
        checks.extend([
            verification_check(
                "cargo-format",
                "Rust formatting",
                &cargo_command("fmt", " --all -- --check"),
                source,
                "core",
                120_000,
            ),
            verification_check(
                "cargo-check",
                "Rust check",
                &cargo_command("check", ""),
                source,
                "core",
                300_000,
            ),
            verification_check(
                "cargo-test",
                "Rust tests",
                &cargo_command("test", ""),
                source,
                "core",
                600_000,
            ),
        ]);
    }
    if root.join("pyproject.toml").is_file() || root.join("requirements.txt").is_file() {
        checks.push(verification_check(
            "python-tests",
            "Python tests",
            "python -m pytest",
            if root.join("pyproject.toml").is_file() {
                "pyproject.toml"
            } else {
                "requirements.txt"
            },
            "core",
            300_000,
        ));
    }
    let has_dotnet_project = fs::read_dir(root)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .any(|entry| {
            entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    matches!(extension.to_ascii_lowercase().as_str(), "sln" | "csproj")
                })
        });
    if has_dotnet_project {
        checks.push(verification_check(
            "dotnet-build",
            ".NET build",
            "dotnet build",
            "solution/project file",
            "core",
            300_000,
        ));
    }
    if checks.is_empty() {
        warnings.push(
            "No conservative verification commands were detected. Use the terminal or add project scripts, then refresh."
                .to_string(),
        );
    }
    (checks, warnings)
}

#[tauri::command]
pub async fn discover_verification_plan(
    state: State<'_, BackendState>,
) -> Result<VerificationPlan, String> {
    let root = selected_workspace_path(state.inner())?;
    let (checks, warnings) = verification_plan_for_root(&root);
    Ok(VerificationPlan {
        workspace: root.to_string_lossy().into_owned(),
        checks,
        warnings,
    })
}

// ─── Checkpoint / rollback ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRequest {
    pub label: Option<String>,
    pub operation_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointResult {
    pub operation_id: String,
    pub commit: String,
    pub message: String,
}

/// Build a non-disruptive checkpoint in an existing Git worktree.
pub(crate) fn checkpoint_script(operation_id: &str) -> String {
    r#"
$ErrorActionPreference = "Stop"
git rev-parse --is-inside-work-tree | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Whim checkpoints require an existing Git worktree." }
git rev-parse --verify HEAD | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Whim checkpoints require a committed HEAD." }
$indexPath = (git rev-parse --git-path "__WHIM_INDEX__" | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0 -or -not $indexPath) { throw "Could not create a temporary Git checkpoint index." }
$env:GIT_INDEX_FILE = $indexPath
try {
  git read-tree HEAD
  if ($LASTEXITCODE -ne 0) { throw "Could not read the current Git tree." }
  git add -u
  if ($LASTEXITCODE -ne 0) { throw "Could not stage tracked changes for the checkpoint." }
  git diff-index --quiet HEAD --
  $difference = $LASTEXITCODE
  if ($difference -eq 0) {
    $commit = (git rev-parse HEAD | Select-Object -Last 1).Trim()
  } elseif ($difference -eq 1) {
    $tree = (git write-tree | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $tree) { throw "Could not create the checkpoint tree." }
    $commit = (git -c "user.name=Whim Agent" -c "user.email=agent@whim.local" commit-tree $tree -p HEAD -m "whim-checkpoint" | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $commit) { throw "Could not write the checkpoint commit." }
  } else {
    throw "Could not compare the checkpoint tree."
  }
  git update-ref refs/whim/checkpoints/latest $commit
  if ($LASTEXITCODE -ne 0) { throw "Could not save the Whim checkpoint ref." }
  Write-Output $commit
} finally {
  Remove-Item -LiteralPath $indexPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath ($indexPath + ".lock") -Force -ErrorAction SilentlyContinue
  Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
}
"#
    .replace("__WHIM_INDEX__", &format!("whim-index-{operation_id}"))
}

/// Restore a checkpoint's tracked state.
pub(crate) fn rollback_script(commit: &str) -> String {
    r#"
$ErrorActionPreference = "Stop"
git rev-parse --is-inside-work-tree | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Whim rollback requires an existing Git worktree." }
git rev-parse --verify "__WHIM_COMMIT__^{commit}" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The requested Whim checkpoint is unavailable." }
$trackedChanges = @(& git diff --name-only; & git diff --cached --name-only) | Where-Object { $_ -and $_.Trim() }
$stashCreated = $false
if ($trackedChanges.Count -gt 0) {
  git stash push -q -m "whim-rollback-tracked"
  if ($LASTEXITCODE -ne 0) { throw "Could not preserve current tracked work in a Git stash." }
  $stashCreated = $true
}
git restore --source "__WHIM_COMMIT__" --staged --worktree -- .
if ($LASTEXITCODE -ne 0) { throw "Could not restore tracked files from the checkpoint." }
Write-Output ("WHIM_STASH_CREATED=" + $stashCreated.ToString().ToLowerInvariant())
git rev-parse "__WHIM_COMMIT__"
"#
    .replace("__WHIM_COMMIT__", commit)
}

pub(crate) fn final_output_line(output: &str) -> Option<String> {
    output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("WHIM_"))
        .map(ToOwned::to_owned)
}

#[tauri::command]
pub async fn workspace_checkpoint(
    state: State<'_, BackendState>,
    request: CheckpointRequest,
) -> Result<CheckpointResult, String> {
    let root = selected_workspace_path(state.inner())?;
    workspace_checkpoint_at(state, root, request).await
}

/// Save a checkpoint at an already-authorized execution root.
pub(crate) async fn workspace_checkpoint_at(
    state: State<'_, BackendState>,
    root: PathBuf,
    request: CheckpointRequest,
) -> Result<CheckpointResult, String> {
    let operation_id = validated_operation_id(request.operation_id)?;
    let message = match &request.label {
        Some(label) if !label.trim().is_empty() => label.trim().to_string(),
        _ => "Checkpoint".to_string(),
    };
    let script = checkpoint_script(&operation_id);
    let result = run_powershell_command_at(
        state,
        root,
        super::execution::PowerShellRequest {
            command: script,
            confirmed: true,
            timeout_ms: Some(60_000),
            operation_id: Some(operation_id.clone()),
            display_command: Some("Whim checkpoint".to_string()),
        },
    )
    .await?;
    if !result.success {
        return Err(format!("Checkpoint failed: {}", result.stderr.trim()));
    }
    let commit = final_output_line(&result.stdout)
        .ok_or_else(|| "Checkpoint failed: Git did not return a commit reference.".to_string())?;
    Ok(CheckpointResult {
        operation_id,
        commit,
        message,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackRequest {
    pub commit: Option<String>,
    pub operation_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub operation_id: String,
    pub restored_commit: String,
    pub stash_created: bool,
}

#[tauri::command]
pub async fn workspace_rollback(
    state: State<'_, BackendState>,
    request: RollbackRequest,
) -> Result<RollbackResult, String> {
    let root = selected_workspace_path(state.inner())?;
    workspace_rollback_at(state, root, request).await
}

/// Restore a checkpoint at an already-authorized execution root.
pub(crate) async fn workspace_rollback_at(
    state: State<'_, BackendState>,
    root: PathBuf,
    request: RollbackRequest,
) -> Result<RollbackResult, String> {
    let operation_id = validated_operation_id(request.operation_id)?;
    let commit = match &request.commit {
        Some(commit) if !commit.trim().is_empty() => commit.trim().to_string(),
        _ => "refs/whim/checkpoints/latest".to_string(),
    };
    let script = rollback_script(&commit);
    let result = run_powershell_command_at(
        state,
        root,
        super::execution::PowerShellRequest {
            command: script,
            confirmed: true,
            timeout_ms: Some(60_000),
            operation_id: Some(operation_id.clone()),
            display_command: Some("Whim rollback".to_string()),
        },
    )
    .await?;
    if !result.success {
        return Err(format!("Rollback failed: {}", result.stderr.trim()));
    }
    let restored_commit = final_output_line(&result.stdout).ok_or_else(|| {
        "Rollback failed: Git did not return a restored commit reference.".to_string()
    })?;
    let stash_created = result
        .stdout
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case("WHIM_STASH_CREATED=true"));
    Ok(RollbackResult {
        operation_id,
        restored_commit,
        stash_created,
    })
}

// Re-use run_powershell_command_at from execution module
use super::execution::run_powershell_command_at;

// ─── Package install ──────────────────────────────────────────────────────────

pub(crate) fn validate_package_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 214 {
        return Err("Package name is invalid".to_string());
    }
    if !name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "@./_-".contains(character))
    {
        return Err("Package name contains unsupported characters".to_string());
    }
    if name.starts_with('.') || name.starts_with('/') || name.contains("..") {
        return Err("Package name is invalid".to_string());
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub packages: Vec<String>,
    pub operation_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub operation_id: String,
    pub installed: Vec<String>,
    pub failed: Vec<String>,
}

#[tauri::command]
pub async fn install_dependencies(
    state: State<'_, BackendState>,
    request: InstallRequest,
) -> Result<InstallResult, String> {
    let operation_id = validated_operation_id(request.operation_id)?;
    let root = selected_workspace_path(state.inner())?;
    let mut installed: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    for package in &request.packages {
        if let Err(error) = validate_package_name(package) {
            failed.push(format!("{package}: {error}"));
            continue;
        }
        let script = format!("npm install --save {}", package);
        let result = run_powershell_command_at(
            state.clone(),
            root.clone(),
            super::execution::PowerShellRequest {
                command: script,
                confirmed: true,
                timeout_ms: Some(120_000),
                operation_id: Some(format!("{operation_id}-{package}")),
                display_command: Some(format!("npm install {package}")),
            },
        )
        .await;
        match result {
            Ok(result) if result.success => installed.push(package.clone()),
            Ok(result) => failed.push(format!("{package}: {}", result.stderr.trim())),
            Err(error) => failed.push(format!("{package}: {error}")),
        }
    }
    Ok(InstallResult {
        operation_id,
        installed,
        failed,
    })
}

// ─── Local preview / tunnel ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRequest {
    pub port: Option<u16>,
    pub operation_id: Option<String>,
}

#[tauri::command]
pub async fn start_local_preview(
    state: State<'_, BackendState>,
    request: PreviewRequest,
) -> Result<CommandResult, String> {
    let root = selected_workspace_path(state.inner())?;
    start_local_preview_at(state, root, request).await
}

/// Start a preview in an already-authorized execution root.
pub(crate) async fn start_local_preview_at(
    state: State<'_, BackendState>,
    root: PathBuf,
    request: PreviewRequest,
) -> Result<CommandResult, String> {
    let operation_id = validated_operation_id(request.operation_id)?;
    let port = request.port.unwrap_or(3000);
    let script = format!("npx -y serve -l {port}");
    run_powershell_command_at(
        state,
        root,
        super::execution::PowerShellRequest {
            command: script,
            confirmed: true,
            timeout_ms: Some(DEFAULT_COMMAND_TIMEOUT_MS),
            operation_id: Some(operation_id),
            display_command: Some(format!("Preview on port {port}")),
        },
    )
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelRequest {
    pub port: Option<u16>,
    pub operation_id: Option<String>,
}

#[tauri::command]
pub async fn start_tunnel(
    state: State<'_, BackendState>,
    request: TunnelRequest,
) -> Result<CommandResult, String> {
    let root = selected_workspace_path(state.inner())?;
    start_tunnel_at(state, root, request).await
}

/// Start an explicit public tunnel in an already-authorized execution root.
pub(crate) async fn start_tunnel_at(
    state: State<'_, BackendState>,
    root: PathBuf,
    request: TunnelRequest,
) -> Result<CommandResult, String> {
    let operation_id = validated_operation_id(request.operation_id)?;
    let port = request.port.unwrap_or(3000);
    let script = format!("npx -y localtunnel --port {port}");
    run_powershell_command_at(
        state,
        root,
        super::execution::PowerShellRequest {
            command: script,
            confirmed: true,
            timeout_ms: Some(DEFAULT_COMMAND_TIMEOUT_MS),
            operation_id: Some(operation_id),
            display_command: Some(format!("Tunnel on port {port}")),
        },
    )
    .await
}

// ─── Deploy types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeployTarget {
    Vercel,
    Netlify,
    Cloudflare,
    Render,
    Railway,
    Fly,
    Docker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeployMode {
    Preview,
    Production,
    Local,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct DeployOptions {
    pub service_id: Option<String>,
    pub app_name: Option<String>,
    pub image_tag: Option<String>,
    pub environment: Option<String>,
    pub project_id: Option<String>,
    pub service: Option<String>,
    pub compose_file: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployPreflightRequest {
    pub target: DeployTarget,
    pub mode: DeployMode,
    pub options: Option<DeployOptions>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployPreflight {
    pub target: DeployTarget,
    pub mode: DeployMode,
    pub ready: bool,
    pub cli_name: String,
    pub cli_path: Option<String>,
    pub project_signals: Vec<String>,
    pub warnings: Vec<String>,
    pub planned_command: Option<String>,
    pub requires_confirmation: bool,
    pub supports_preview: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployRequest {
    pub target: DeployTarget,
    pub mode: DeployMode,
    pub options: Option<DeployOptions>,
    pub confirmed: bool,
    pub production_confirmed: Option<bool>,
    pub timeout_ms: Option<u64>,
    pub operation_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResult {
    pub preflight: DeployPreflight,
    pub command: CommandResult,
}

// ─── Deploy helpers ───────────────────────────────────────────────────────────

fn deploy_cli(target: DeployTarget) -> &'static str {
    match target {
        DeployTarget::Vercel => "vercel",
        DeployTarget::Netlify => "netlify",
        DeployTarget::Cloudflare => "wrangler",
        DeployTarget::Render => "render",
        DeployTarget::Railway => "railway",
        DeployTarget::Fly => "fly",
        DeployTarget::Docker => "docker",
    }
}

fn deploy_supports_preview(target: DeployTarget) -> bool {
    matches!(
        target,
        DeployTarget::Vercel
            | DeployTarget::Netlify
            | DeployTarget::Cloudflare
            | DeployTarget::Railway
    )
}

pub(crate) fn deploy_mode_supported(target: DeployTarget, mode: DeployMode) -> bool {
    match target {
        DeployTarget::Vercel | DeployTarget::Netlify | DeployTarget::Cloudflare => {
            matches!(mode, DeployMode::Preview | DeployMode::Production)
        }
        DeployTarget::Railway => matches!(mode, DeployMode::Preview | DeployMode::Production),
        DeployTarget::Render | DeployTarget::Fly => mode == DeployMode::Production,
        DeployTarget::Docker => mode == DeployMode::Local,
    }
}

fn project_signals(root: &Path, target: DeployTarget) -> Vec<String> {
    let candidates: &[&str] = match target {
        DeployTarget::Vercel => &["vercel.json", ".vercel/project.json", "package.json"],
        DeployTarget::Netlify => &["netlify.toml", "package.json"],
        DeployTarget::Cloudflare => &[
            "wrangler.toml",
            "wrangler.json",
            "wrangler.jsonc",
            "package.json",
        ],
        DeployTarget::Render => &["render.yaml", "Dockerfile", "package.json"],
        DeployTarget::Railway => &["railway.json", "railway.toml", "Dockerfile", "package.json"],
        DeployTarget::Fly => &["fly.toml", "Dockerfile"],
        DeployTarget::Docker => &[
            "compose.yaml",
            "compose.yml",
            "docker-compose.yaml",
            "docker-compose.yml",
            "Dockerfile",
        ],
    };
    candidates
        .iter()
        .filter(|candidate| root.join(candidate).exists())
        .map(|candidate| (*candidate).to_string())
        .collect()
}

pub(crate) fn deploy_args(
    _root: &Path,
    target: DeployTarget,
    mode: DeployMode,
    options: &DeployOptions,
) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    match target {
        DeployTarget::Vercel => {
            if mode == DeployMode::Production {
                args.push("--prod".to_string());
            }
            args.push("--yes".to_string());
        }
        DeployTarget::Netlify => {
            args.push("deploy".to_string());
            if mode == DeployMode::Production {
                args.push("--prod".to_string());
            }
        }
        DeployTarget::Cloudflare => {
            if mode == DeployMode::Preview {
                args.push("pages".to_string());
                args.push("deploy".to_string());
            } else {
                args.push("deploy".to_string());
            }
        }
        DeployTarget::Render => {
            args.push("deploy".to_string());
            if let Some(service) = &options.service_id {
                args.push("--service-id".to_string());
                args.push(service.clone());
            }
        }
        DeployTarget::Railway => {
            args.push("up".to_string());
        }
        DeployTarget::Fly => {
            args.push("deploy".to_string());
            if let Some(app) = &options.app_name {
                args.push("--app".to_string());
                args.push(app.clone());
            }
        }
        DeployTarget::Docker => {
            let compose_file = options
                .compose_file
                .clone()
                .unwrap_or_else(|| "compose.yaml".to_string());
            args.push("compose".to_string());
            args.push("-f".to_string());
            args.push(compose_file);
            args.push("up".to_string());
            args.push("-d".to_string());
            args.push("--build".to_string());
        }
    }
    Ok(args)
}

/// Validate that an optional deploy value (service ID, app name, etc.) contains
/// only allowed characters and is within length limits.
#[allow(dead_code)]
pub(crate) fn validate_deploy_value(
    value: &Option<String>,
    label: &str,
    allowed: &str,
    max_length: usize,
) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.len() > max_length {
        return Err(format!("{label} must be at most {max_length} characters"));
    }
    for ch in value.chars() {
        if !allowed.contains(ch) && !ch.is_alphanumeric() && ch != '-' && ch != '_' {
            return Err(format!(
                "{label} contains invalid character '{ch}'; allowed: {allowed} and alphanumeric"
            ));
        }
    }
    Ok(())
}

async fn deploy_preflight_internal(
    root: &Path,
    target: DeployTarget,
    mode: DeployMode,
    options: &DeployOptions,
) -> Result<DeployPreflight, String> {
    let cli_name = deploy_cli(target);
    let signals = project_signals(root, target);
    let supported_mode = deploy_mode_supported(target, mode);
    let mut warnings = Vec::new();
    if !supported_mode {
        warnings.push(format!(
            "{cli_name} does not support the requested deployment mode"
        ));
    }

    // Check if CLI is available
    let (_, _, cli_found) = quick_capture(
        #[cfg(windows)]
        "where.exe",
        #[cfg(not(windows))]
        "which",
        &[cli_name.to_string()],
        None,
        5_000,
    )
    .await
    .unwrap_or(("".to_string(), "".to_string(), false));

    let cli_path = if cli_found {
        Some(cli_name.to_string())
    } else {
        warnings.push(format!("{cli_name} is not installed or not on PATH"));
        None
    };

    let planned_command = deploy_args(root, target, mode, options)
        .ok()
        .map(|args| format!("{cli_name} {}", args.join(" ")));

    let ready = supported_mode && cli_found;

    Ok(DeployPreflight {
        target,
        mode,
        ready,
        cli_name: cli_name.to_string(),
        cli_path,
        project_signals: signals,
        warnings,
        planned_command,
        requires_confirmation: mode == DeployMode::Production,
        supports_preview: deploy_supports_preview(target),
    })
}

#[tauri::command]
pub async fn deploy_preflight(
    state: State<'_, BackendState>,
    request: DeployPreflightRequest,
) -> Result<DeployPreflight, String> {
    let root = selected_workspace_path(state.inner())?;
    deploy_preflight_internal(
        &root,
        request.target,
        request.mode,
        &request.options.unwrap_or_default(),
    )
    .await
}

#[tauri::command]
pub async fn deploy_workspace(
    state: State<'_, BackendState>,
    request: DeployRequest,
) -> Result<DeployResult, String> {
    if !request.confirmed {
        return Err(whim_err(
            "DEPLOY_CONFIRMATION_REQUIRED",
            "Deployment requires confirmed=true",
        ));
    }
    if request.mode == DeployMode::Production && !request.production_confirmed.unwrap_or(false) {
        return Err(whim_err(
            "PRODUCTION_CONFIRMATION_REQUIRED",
            "Production deployment requires an explicit, separate production confirmation",
        ));
    }
    let root = selected_workspace_path(state.inner())?;
    let options = request.options.unwrap_or_default();
    let preflight =
        deploy_preflight_internal(&root, request.target, request.mode, &options).await?;
    if !preflight.ready {
        return Err(whim_err(
            "DEPLOY_PREFLIGHT_FAILED",
            &format!(
                "Deployment preflight failed: {}",
                preflight.warnings.join("; ")
            ),
        ));
    }
    let cli_path = preflight
        .cli_path
        .clone()
        .ok_or_else(|| "Deployment CLI path is missing".to_string())?;
    let args = deploy_args(&root, request.target, request.mode, &options)?;
    let command = execute_tracked(
        state.inner(),
        request.operation_id,
        &format!("deploy-{}", preflight.cli_name),
        ProcessSpec {
            adapter: crate::harness::ExecutionAdapter::NativeWindows,
            program: preferred_powershell(),
            args: powershell_args(tool_script(&cli_path, &args), false),
            display_command: preflight
                .planned_command
                .clone()
                .unwrap_or_else(|| format!("{} deploy", preflight.cli_name)),
            cwd: root,
            timeout_ms: clamp_timeout(
                request.timeout_ms,
                DEFAULT_DEPLOY_TIMEOUT_MS,
                MAX_DEPLOY_TIMEOUT_MS,
            ),
            environment: vec![("CI".to_string(), "1".to_string())],
            environment_remove: Vec::new(),
        },
    )
    .await?;
    Ok(DeployResult { preflight, command })
}

// ─── Provider discovery ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub provider: String,
    pub label: String,
    pub kind: String,
    pub available: bool,
    pub has_key: bool,
    pub base_url: Option<String>,
    pub note: Option<String>,
    pub capabilities: ProviderCapabilities,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub chat: bool,
    pub speech_to_text: bool,
    pub text_to_speech: bool,
}

fn capabilities(provider: &str) -> ProviderCapabilities {
    let openai_voice = matches!(provider, "openai" | "compatible");
    ProviderCapabilities {
        chat: true,
        speech_to_text: openai_voice,
        text_to_speech: openai_voice,
    }
}

fn tcp_reachable(host: &str, port: u16) -> bool {
    let addr: std::net::SocketAddr = match format!("{host}:{port}").parse() {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(600)).is_ok()
}

#[tauri::command]
pub fn discover_providers() -> Vec<ProviderStatus> {
    let omniroute = tcp_reachable("127.0.0.1", 20128);
    let ollama = tcp_reachable("127.0.0.1", 11434);
    let lm_studio = tcp_reachable("127.0.0.1", 1234);
    let local_base = if ollama {
        Some("http://localhost:11434/v1".to_string())
    } else if lm_studio {
        Some("http://localhost:1234/v1".to_string())
    } else {
        None
    };
    let mut out = vec![ProviderStatus {
        provider: "local".to_string(),
        label: "Local (Ollama / LM Studio)".to_string(),
        kind: "local".to_string(),
        available: ollama || lm_studio,
        has_key: true,
        base_url: local_base,
        note: if ollama {
            Some("Ollama detected on :11434".to_string())
        } else if lm_studio {
            Some("LM Studio detected on :1234".to_string())
        } else {
            None
        },
        capabilities: capabilities("local"),
    }];
    out.push(ProviderStatus {
        provider: "omniroute".to_string(),
        label: "OmniRoute".to_string(),
        kind: "gateway".to_string(),
        available: omniroute,
        has_key: std::env::var("OMNIROUTE_API_KEY")
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        base_url: Some("http://127.0.0.1:20128/v1".to_string()),
        note: Some(if omniroute {
            "Local routing gateway detected on :20128; endpoint key is optional unless OmniRoute requires one."
                .to_string()
        } else {
            "Start OmniRoute to enable automatic free, cheap, fast, and coding routes."
                .to_string()
        }),
        capabilities: capabilities("omniroute"),
    });
    let cloud: &[(&str, &str, &str)] = &[
        ("openai", "OPENAI_API_KEY", "OpenAI"),
        ("anthropic", "ANTHROPIC_API_KEY", "Anthropic"),
        ("google", "GOOGLE_API_KEY", "Google Gemini"),
        ("deepseek", "DEEPSEEK_API_KEY", "DeepSeek"),
        ("qwen", "DASHSCOPE_API_KEY", "Qwen"),
        ("xiaomi", "XIAOMI_API_KEY", "Xiaomi"),
    ];
    for (provider, env_key, label) in cloud {
        let has = std::env::var(env_key).is_ok();
        out.push(ProviderStatus {
            provider: provider.to_string(),
            label: label.to_string(),
            kind: "cloud".to_string(),
            available: has,
            has_key: has,
            base_url: None,
            note: None,
            capabilities: capabilities(provider),
        });
    }
    out
}

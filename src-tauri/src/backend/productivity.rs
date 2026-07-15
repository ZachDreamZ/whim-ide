use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;
use tokio::{
    process::Command,
    time::{timeout, Duration},
};
use uuid::Uuid;

use super::{plugins, workspace::resolve_agent_workspace, BackendState};

const MAX_CONFIG_BYTES: u64 = 256 * 1024;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(20);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduleRecurrence {
    Once,
    Daily,
    Weekdays,
    Weekly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub recurrence: ScheduleRecurrence,
    pub next_run_at_ms: u64,
    pub enabled: bool,
    pub mode: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at_ms: u64,
    pub last_run_at_ms: Option<u64>,
    pub last_job_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveScheduledTaskRequest {
    pub workspace: String,
    pub id: Option<String>,
    pub title: String,
    pub prompt: String,
    pub recurrence: ScheduleRecurrence,
    pub next_run_at_ms: u64,
    pub enabled: Option<bool>,
    pub mode: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRequest {
    pub workspace: String,
    pub schedule_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleScheduleRequest {
    pub workspace: String,
    pub schedule_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkScheduleRunRequest {
    pub workspace: String,
    pub schedule_id: String,
    pub job_id: String,
}

fn schedules_path(workspace: &Path) -> PathBuf {
    workspace.join(".whim").join("schedules.json")
}

fn load_schedules(workspace: &Path) -> Result<Vec<ScheduledTask>, String> {
    let path = schedules_path(workspace);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
    if metadata.len() > MAX_CONFIG_BYTES {
        return Err("Schedule file is unexpectedly large".into());
    }
    serde_json::from_slice(
        &fs::read(&path).map_err(|error| format!("Cannot read schedules: {error}"))?,
    )
    .map_err(|error| format!("Invalid {}: {error}", path.display()))
}

fn save_schedules(workspace: &Path, schedules: &[ScheduledTask]) -> Result<(), String> {
    let path = schedules_path(workspace);
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid schedules path".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = path.with_extension(format!("json.{}.tmp", Uuid::new_v4()));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(schedules).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Cannot write schedules: {error}"))?;
    if !path.exists() {
        return fs::rename(&temporary, &path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Cannot create schedules: {error}")
        });
    }
    // Windows rename does not replace an existing destination. Use a bounded
    // backup swap so an interrupted update always leaves either the old or new
    // valid JSON available instead of truncating the schedule ledger in place.
    let backup = path.with_extension(format!("json.{}.bak", Uuid::new_v4()));
    fs::rename(&path, &backup).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Cannot prepare schedule update: {error}")
    })?;
    match fs::rename(&temporary, &path) {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup, &path);
            let _ = fs::remove_file(&temporary);
            Err(format!("Cannot replace schedules: {error}"))
        }
    }
}

fn validate_schedule(title: &str, prompt: &str, next_run_at_ms: u64) -> Result<(), String> {
    if title.trim().is_empty() || title.chars().count() > 120 {
        return Err("Schedule title must be 1-120 characters".into());
    }
    if prompt.trim().is_empty() || prompt.chars().count() > 20_000 {
        return Err("Schedule prompt must be 1-20,000 characters".into());
    }
    if next_run_at_ms == 0 {
        return Err("Schedule needs a valid next run time".into());
    }
    Ok(())
}

fn advance_schedule(task: &mut ScheduledTask, claimed_at: u64) {
    const DAY: u64 = 86_400_000;
    task.last_run_at_ms = Some(claimed_at);
    task.last_job_id = None;
    match task.recurrence {
        ScheduleRecurrence::Once => task.enabled = false,
        ScheduleRecurrence::Daily => {
            while task.next_run_at_ms <= claimed_at {
                task.next_run_at_ms = task.next_run_at_ms.saturating_add(DAY);
            }
        }
        ScheduleRecurrence::Weekly => {
            while task.next_run_at_ms <= claimed_at {
                task.next_run_at_ms = task.next_run_at_ms.saturating_add(7 * DAY);
            }
        }
        ScheduleRecurrence::Weekdays => {
            while task.next_run_at_ms <= claimed_at {
                task.next_run_at_ms = task.next_run_at_ms.saturating_add(DAY);
                let epoch_day = task.next_run_at_ms / DAY;
                let weekday = (epoch_day + 4) % 7; // 1970-01-01 was Thursday; Sunday=0.
                if weekday == 0 {
                    task.next_run_at_ms = task.next_run_at_ms.saturating_add(DAY);
                } else if weekday == 6 {
                    task.next_run_at_ms = task.next_run_at_ms.saturating_add(2 * DAY);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn list_scheduled_tasks(
    state: State<'_, BackendState>,
    workspace: String,
) -> Result<Vec<ScheduledTask>, String> {
    let root = resolve_agent_workspace(state.inner(), Some(&workspace)).await?;
    load_schedules(&root)
}

#[tauri::command]
pub async fn save_scheduled_task(
    state: State<'_, BackendState>,
    request: SaveScheduledTaskRequest,
) -> Result<ScheduledTask, String> {
    validate_schedule(&request.title, &request.prompt, request.next_run_at_ms)?;
    let root = resolve_agent_workspace(state.inner(), Some(&request.workspace)).await?;
    let mut schedules = load_schedules(&root)?;
    let created_at = now_ms();
    let id = request
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let previous = schedules.iter().find(|task| task.id == id).cloned();
    let task = ScheduledTask {
        id: id.clone(),
        title: request.title.trim().to_string(),
        prompt: request.prompt.trim().to_string(),
        recurrence: request.recurrence,
        next_run_at_ms: request.next_run_at_ms,
        enabled: request.enabled.unwrap_or(true),
        mode: request
            .mode
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| "build".into()),
        provider: request.provider.filter(|v| !v.trim().is_empty()),
        model: request.model.filter(|v| !v.trim().is_empty()),
        created_at_ms: previous
            .as_ref()
            .map(|task| task.created_at_ms)
            .unwrap_or(created_at),
        last_run_at_ms: previous.as_ref().and_then(|task| task.last_run_at_ms),
        last_job_id: previous.and_then(|task| task.last_job_id),
    };
    if let Some(index) = schedules.iter().position(|candidate| candidate.id == id) {
        schedules[index] = task.clone();
    } else {
        schedules.push(task.clone());
    }
    schedules.sort_by_key(|candidate| candidate.next_run_at_ms);
    save_schedules(&root, &schedules)?;
    Ok(task)
}

#[tauri::command]
pub async fn delete_scheduled_task(
    state: State<'_, BackendState>,
    request: ScheduleRequest,
) -> Result<(), String> {
    let root = resolve_agent_workspace(state.inner(), Some(&request.workspace)).await?;
    let mut schedules = load_schedules(&root)?;
    schedules.retain(|task| task.id != request.schedule_id);
    save_schedules(&root, &schedules)
}

#[tauri::command]
pub async fn toggle_scheduled_task(
    state: State<'_, BackendState>,
    request: ToggleScheduleRequest,
) -> Result<ScheduledTask, String> {
    let root = resolve_agent_workspace(state.inner(), Some(&request.workspace)).await?;
    let mut schedules = load_schedules(&root)?;
    let task = schedules
        .iter_mut()
        .find(|task| task.id == request.schedule_id)
        .ok_or_else(|| "Scheduled task was not found".to_string())?;
    task.enabled = request.enabled;
    let result = task.clone();
    save_schedules(&root, &schedules)?;
    Ok(result)
}

#[tauri::command]
pub async fn claim_due_scheduled_tasks(
    state: State<'_, BackendState>,
    workspace: String,
) -> Result<Vec<ScheduledTask>, String> {
    let root = resolve_agent_workspace(state.inner(), Some(&workspace)).await?;
    let mut schedules = load_schedules(&root)?;
    let current = now_ms();
    let due: Vec<ScheduledTask> = schedules
        .iter()
        .filter(|task| task.enabled && task.next_run_at_ms <= current)
        .cloned()
        .collect();
    for task in schedules
        .iter_mut()
        .filter(|task| task.enabled && task.next_run_at_ms <= current)
    {
        advance_schedule(task, current);
    }
    if !due.is_empty() {
        save_schedules(&root, &schedules)?;
    }
    Ok(due)
}

#[tauri::command]
pub async fn mark_scheduled_task_run(
    state: State<'_, BackendState>,
    request: MarkScheduleRunRequest,
) -> Result<(), String> {
    let root = resolve_agent_workspace(state.inner(), Some(&request.workspace)).await?;
    let mut schedules = load_schedules(&root)?;
    let task = schedules
        .iter_mut()
        .find(|task| task.id == request.schedule_id)
        .ok_or_else(|| "Scheduled task was not found".to_string())?;
    task.last_job_id = Some(request.job_id);
    save_schedules(&root, &schedules)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitesStatus {
    pub plugin_installed: bool,
    pub plugin_version: Option<String>,
    pub config_exists: bool,
    pub config_path: String,
    pub project_id: Option<String>,
    pub site_slug: Option<String>,
    pub access: Option<String>,
    pub build_command: Option<String>,
    pub output_directory: Option<String>,
    pub raw_config: Option<Value>,
}

fn config_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
        .map(str::to_string)
}

#[tauri::command]
pub async fn inspect_sites_workspace(
    state: State<'_, BackendState>,
    workspace: String,
) -> Result<SitesStatus, String> {
    let root = resolve_agent_workspace(state.inner(), Some(&workspace)).await?;
    let config_path = root.join(".openai").join("hosting.json");
    let config = if config_path.is_file() {
        let metadata = fs::metadata(&config_path).map_err(|error| error.to_string())?;
        if metadata.len() > MAX_CONFIG_BYTES {
            return Err("Sites hosting config is unexpectedly large".into());
        }
        Some(
            serde_json::from_slice::<Value>(
                &fs::read(&config_path).map_err(|error| error.to_string())?,
            )
            .map_err(|error| format!("Invalid {}: {error}", config_path.display()))?,
        )
    } else {
        None
    };
    let discovered = plugins::list_codex_plugins().await.unwrap_or_default();
    let sites = discovered
        .iter()
        .find(|plugin| plugin.id.eq_ignore_ascii_case("sites"));
    Ok(SitesStatus {
        plugin_installed: sites.is_some(),
        plugin_version: sites.map(|plugin| plugin.version.clone()),
        config_exists: config.is_some(),
        config_path: config_path.to_string_lossy().into_owned(),
        project_id: config
            .as_ref()
            .and_then(|value| config_string(value, &["projectId", "project_id"])),
        site_slug: config
            .as_ref()
            .and_then(|value| config_string(value, &["slug", "siteSlug", "site_slug"])),
        access: config
            .as_ref()
            .and_then(|value| config_string(value, &["access", "visibility"])),
        build_command: config
            .as_ref()
            .and_then(|value| config_string(value, &["buildCommand", "build_command"])),
        output_directory: config.as_ref().and_then(|value| {
            config_string(value, &["outputDirectory", "output_directory", "outputDir"])
        }),
        raw_config: config,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestItem {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub is_draft: bool,
    pub url: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub author: Option<String>,
    pub updated_at: Option<String>,
    pub repository: String,
    pub relationship: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestStatus {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub remote_url: Option<String>,
    pub github_authenticated: bool,
    pub account_login: Option<String>,
    pub pull_requests: Vec<PullRequestItem>,
    pub previously_reviewed: Vec<PullRequestItem>,
    pub message: Option<String>,
}

fn parse_pull_requests(bytes: &[u8], relationship: &str) -> Result<Vec<PullRequestItem>, String> {
    let values: Vec<Value> = serde_json::from_slice(bytes)
        .map_err(|error| format!("GitHub returned invalid PR data: {error}"))?;
    Ok(values
        .into_iter()
        .filter_map(|value| {
            Some(PullRequestItem {
                number: value.get("number")?.as_u64()?,
                title: value.get("title")?.as_str()?.to_string(),
                state: value.get("state")?.as_str()?.to_string(),
                is_draft: value
                    .get("isDraft")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                url: value.get("url")?.as_str()?.to_string(),
                head_ref_name: value
                    .get("headRefName")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                base_ref_name: value
                    .get("baseRefName")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                author: value
                    .pointer("/author/login")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                updated_at: value
                    .get("updatedAt")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                repository: value
                    .pointer("/repository/nameWithOwner")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                relationship: relationship.to_string(),
            })
        })
        .collect())
}

async fn output(
    workspace: &Path,
    program: &str,
    args: &[&str],
) -> Result<std::process::Output, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    timeout(PROCESS_TIMEOUT, command.output())
        .await
        .map_err(|_| format!("{program} timed out"))?
        .map_err(|error| format!("Cannot run {program}: {error}"))
}

async fn search_pull_requests(
    workspace: &Path,
    filter: &str,
    state: &str,
    relationship: &str,
) -> Result<Vec<PullRequestItem>, String> {
    let result = output(
        workspace,
        "gh",
        &[
            "search",
            "prs",
            filter,
            "@me",
            "--state",
            state,
            "--limit",
            "50",
            "--sort",
            "updated",
            "--order",
            "desc",
            "--json",
            "number,title,state,isDraft,url,repository,author,updatedAt",
        ],
    )
    .await?;
    if !result.status.success() {
        return Err(String::from_utf8_lossy(&result.stderr).trim().to_string());
    }
    parse_pull_requests(&result.stdout, relationship)
}

#[tauri::command]
pub async fn inspect_pull_requests(
    state: State<'_, BackendState>,
    workspace: String,
) -> Result<PullRequestStatus, String> {
    let root = resolve_agent_workspace(state.inner(), Some(&workspace)).await?;
    let inside = output(&root, "git", &["rev-parse", "--is-inside-work-tree"]).await?;
    let is_repository = inside.status.success();
    let branch = if is_repository {
        let result = output(&root, "git", &["branch", "--show-current"]).await?;
        Some(String::from_utf8_lossy(&result.stdout).trim().to_string())
            .filter(|value| !value.is_empty())
    } else {
        None
    };
    let remote = if is_repository {
        let result = output(&root, "git", &["remote", "get-url", "origin"]).await?;
        if result.status.success() {
            Some(String::from_utf8_lossy(&result.stdout).trim().to_string())
                .filter(|value| !value.is_empty())
        } else {
            None
        }
    } else {
        None
    };
    let auth = output(&root, "gh", &["auth", "status"])
        .await
        .map(|value| value.status.success())
        .unwrap_or(false);
    if !auth {
        return Ok(PullRequestStatus {
            is_repository,
            branch,
            remote_url: remote,
            github_authenticated: false,
            account_login: None,
            pull_requests: vec![],
            previously_reviewed: vec![],
            message: Some(
                "GitHub CLI is not authenticated. Run gh auth login, then refresh.".into(),
            ),
        });
    }
    let (authored, reviewing, reviewed) = tokio::join!(
        search_pull_requests(&root, "--author", "open", "authored"),
        search_pull_requests(&root, "--review-requested", "open", "reviewing"),
        search_pull_requests(&root, "--reviewed-by", "closed", "reviewed"),
    );
    let mut pull_requests = authored?;
    pull_requests.extend(reviewing?);
    pull_requests.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    pull_requests.dedup_by(|a, b| a.url == b.url);
    let account = output(&root, "gh", &["api", "user", "--jq", ".login"])
        .await
        .ok()
        .filter(|result| result.status.success())
        .map(|result| String::from_utf8_lossy(&result.stdout).trim().to_string())
        .filter(|value| !value.is_empty());
    Ok(PullRequestStatus {
        is_repository,
        branch,
        remote_url: remote,
        github_authenticated: true,
        account_login: account,
        pull_requests,
        previously_reviewed: reviewed?,
        message: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn due_once_is_claimed_and_disabled() {
        let mut task = ScheduledTask {
            id: "1".into(),
            title: "Test".into(),
            prompt: "Run".into(),
            recurrence: ScheduleRecurrence::Once,
            next_run_at_ms: 10,
            enabled: true,
            mode: "build".into(),
            provider: None,
            model: None,
            created_at_ms: 1,
            last_run_at_ms: None,
            last_job_id: None,
        };
        advance_schedule(&mut task, 20);
        assert!(!task.enabled);
        assert_eq!(task.last_run_at_ms, Some(20));
    }

    #[test]
    fn daily_schedule_advances_past_claim_time() {
        let mut task = ScheduledTask {
            id: "1".into(),
            title: "Test".into(),
            prompt: "Run".into(),
            recurrence: ScheduleRecurrence::Daily,
            next_run_at_ms: 10,
            enabled: true,
            mode: "build".into(),
            provider: None,
            model: None,
            created_at_ms: 1,
            last_run_at_ms: None,
            last_job_id: None,
        };
        advance_schedule(&mut task, 10);
        assert!(task.next_run_at_ms > 10);
        assert!(task.enabled);
    }

    #[test]
    fn parses_github_pull_request_shape() {
        let items = parse_pull_requests(br#"[{"number":42,"title":"Ship it","state":"OPEN","isDraft":false,"url":"https://github.test/pr/42","repository":{"nameWithOwner":"octo/demo"},"author":{"login":"octo"},"updatedAt":"2026-07-15T00:00:00Z"}]"#, "authored").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].number, 42);
        assert_eq!(items[0].author.as_deref(), Some("octo"));
        assert_eq!(items[0].repository, "octo/demo");
        assert_eq!(items[0].relationship, "authored");
    }

    #[test]
    fn supports_sites_camel_and_snake_case_keys() {
        let camel = serde_json::json!({"projectId":"project-1", "siteSlug":"demo"});
        let snake = serde_json::json!({"project_id":"project-2", "site_slug":"other"});
        assert_eq!(
            config_string(&camel, &["projectId", "project_id"]).as_deref(),
            Some("project-1")
        );
        assert_eq!(
            config_string(&snake, &["projectId", "project_id"]).as_deref(),
            Some("project-2")
        );
    }

    #[test]
    fn schedules_round_trip_through_workspace_file() {
        let root = std::env::temp_dir().join(format!("whim-schedules-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let task = ScheduledTask {
            id: "schedule-1".into(),
            title: "Health check".into(),
            prompt: "Run tests".into(),
            recurrence: ScheduleRecurrence::Weekly,
            next_run_at_ms: 42,
            enabled: true,
            mode: "verify".into(),
            provider: None,
            model: None,
            created_at_ms: 1,
            last_run_at_ms: None,
            last_job_id: None,
        };
        save_schedules(&root, std::slice::from_ref(&task)).unwrap();
        let mut updated = task.clone();
        updated.title = "Updated health check".into();
        save_schedules(&root, std::slice::from_ref(&updated)).unwrap();
        let loaded = load_schedules(&root).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, updated.title);
        assert!(schedules_path(&root).is_file());
        let _ = fs::remove_dir_all(root);
    }
}

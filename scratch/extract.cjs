const fs = require('fs');

const backendContent = fs.readFileSync('src-tauri/src/backend.rs', 'utf8');

function parseBlocks(content) {
    const lines = content.split('\n');
    const blocks = [];
    let currentBlock = [];
    let braceCount = 0;
    let inBlock = false;
    let pendingDecorator = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!inBlock) {
            if (trimmed.startsWith('#[tauri::command]') || trimmed.startsWith('#[cfg(test)]') || trimmed.startsWith('#[derive')) {
                if (pendingDecorator) {
                    currentBlock.push(pendingDecorator);
                }
                pendingDecorator = line;
                continue;
            }

            if (trimmed.startsWith('pub struct') ||
                trimmed.startsWith('pub enum') ||
                trimmed.startsWith('struct ') ||
                trimmed.startsWith('enum ') ||
                trimmed.startsWith('pub fn') ||
                trimmed.startsWith('fn ') ||
                trimmed.startsWith('pub(crate) fn') ||
                trimmed.startsWith('pub(crate) struct') ||
                trimmed.startsWith('impl ') ||
                trimmed.startsWith('mod tests') ||
                trimmed.startsWith('const ')) {
                inBlock = true;
                if (pendingDecorator) {
                    currentBlock.push(pendingDecorator);
                    pendingDecorator = null;
                }
                currentBlock.push(line);
                
                for (let char of trimmed) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                }
                
                if (trimmed.endsWith(';') || (braceCount === 0 && trimmed.includes('{'))) {
                    blocks.push(currentBlock.join('\n'));
                    currentBlock = [];
                    inBlock = false;
                }
            } else {
                if (pendingDecorator) {
                    blocks.push(pendingDecorator);
                    pendingDecorator = null;
                }
                blocks.push(line);
            }
        } else {
            currentBlock.push(line);
            for (let char of line) {
                if (char === '{') braceCount++;
                if (char === '}') braceCount--;
            }
            if (braceCount === 0) {
                blocks.push(currentBlock.join('\n'));
                currentBlock = [];
                inBlock = false;
            }
        }
    }
    return blocks;
}

const blocks = parseBlocks(backendContent);
console.log(`Parsed ${blocks.length} blocks/lines.`);

const workspaceBlocks = [];
const executionBlocks = [];
const providerBlocks = [];
const deploymentBlocks = [];
const orchestrationBlocks = [];
const sharedBlocks = [];
const testsBlocks = [];

function classify(block) {
    const trimmed = block.trim();
    if (trimmed.includes('mod tests')) {
        return 'tests';
    }
    if (trimmed.startsWith('use ') || trimmed.startsWith('const ')) {
        return 'shared';
    }

    const firstLine = trimmed.split('\n')[0] || '';
    
    // Workspace keywords
    if (firstLine.includes('WorkspaceInfo') ||
        firstLine.includes('FileKind') ||
        firstLine.includes('FileEntry') ||
        firstLine.includes('ListWorkspaceRequest') ||
        firstLine.includes('DirectoryListing') ||
        firstLine.includes('WorkspaceTreeRequest') ||
        firstLine.includes('ReadFileRequest') ||
        firstLine.includes('FileContent') ||
        firstLine.includes('WriteFileRequest') ||
        firstLine.includes('FileWriteResult') ||
        firstLine.includes('select_workspace') ||
        firstLine.includes('get_selected_workspace') ||
        firstLine.includes('list_workspace') ||
        firstLine.includes('list_workspace_tree') ||
        firstLine.includes('read_workspace_file') ||
        firstLine.includes('write_workspace_file') ||
        firstLine.includes('ensure_inside') ||
        firstLine.includes('resolve_existing') ||
        firstLine.includes('file_entry') ||
        firstLine.includes('sorted_children') ||
        firstLine.includes('relative_display') ||
        firstLine.includes('modified_ms') ||
        firstLine.includes('sanitize_relative') ||
        firstLine.includes('canonical_workspace') ||
        firstLine.includes('workspace_info') ||
        firstLine.includes('selected_workspace_path') ||
        firstLine.includes('optional_selected_workspace_path') ||
        firstLine.includes('resolve_agent_workspace') ||
        firstLine.includes('ensure_directory_chain') ||
        firstLine.includes('resolve_write_target') ||
        firstLine.includes('TreeOptions')
    ) {
        return 'workspace';
    }

    // Execution keywords
    if (firstLine.includes('RunningOperation') ||
        firstLine.includes('PowerShellRequest') ||
        firstLine.includes('CommandResult') ||
        firstLine.includes('OperationInfo') ||
        firstLine.includes('CancelResult') ||
        firstLine.includes('ProcessSpec') ||
        firstLine.includes('run_powershell_command') ||
        firstLine.includes('cancel_operation') ||
        firstLine.includes('list_active_operations') ||
        firstLine.includes('execute_tracked') ||
        firstLine.includes('run_powershell_command_at') ||
        firstLine.includes('preferred_powershell') ||
        firstLine.includes('hide_console') ||
        firstLine.includes('validated_operation_id') ||
        firstLine.includes('ConciseProcessDetail') ||
        firstLine.includes('concise_process_detail') ||
        firstLine.includes('ps_quote') ||
        firstLine.includes('tool_script') ||
        firstLine.includes('powershell_args') ||
        firstLine.includes('quick_capture') ||
        firstLine.includes('strip_ansi') ||
        firstLine.includes('normalized_loopback_url')
    ) {
        return 'execution';
    }

    // Provider keywords
    if (firstLine.includes('ToolInfo') ||
        firstLine.includes('EnvironmentReport') ||
        firstLine.includes('RawEnvironmentReport') ||
        firstLine.includes('CredentialPresence') ||
        firstLine.includes('CredentialReport') ||
        firstLine.includes('LocalProvidersRequest') ||
        firstLine.includes('LocalModel') ||
        firstLine.includes('LocalProviderStatus') ||
        firstLine.includes('LocalProvidersResult') ||
        firstLine.includes('ProviderStatus') ||
        firstLine.includes('discover_credential_names') ||
        firstLine.includes('discover_environment') ||
        firstLine.includes('discover_local_ai_providers') ||
        firstLine.includes('discover_providers') ||
        firstLine.includes('auto_provider') ||
        firstLine.includes('tcp_reachable') ||
        firstLine.includes('credential_provider') ||
        firstLine.includes('parse_quoted_dotenv_value') ||
        firstLine.includes('parse_dotenv_value') ||
        firstLine.includes('parse_env_names') ||
        firstLine.includes('clamp_timeout') ||
        firstLine.includes('validate_slug') ||
        firstLine.includes('validate_label') ||
        firstLine.includes('home_directory') ||
        firstLine.includes('valid_tool_name') ||
        firstLine.includes('unavailable_tool')
    ) {
        return 'provider';
    }

    // Deployment keywords
    if (firstLine.includes('DeployTarget') ||
        firstLine.includes('DeployMode') ||
        firstLine.includes('DeployOptions') ||
        firstLine.includes('DeployPreflightRequest') ||
        firstLine.includes('DeployPreflight') ||
        firstLine.includes('DeployRequest') ||
        firstLine.includes('DeployResult') ||
        firstLine.includes('deploy_preflight') ||
        firstLine.includes('deploy_workspace') ||
        firstLine.includes('deploy_cli') ||
        firstLine.includes('deploy_supports_preview') ||
        firstLine.includes('deploy_mode_supported') ||
        firstLine.includes('project_signals') ||
        firstLine.includes('list_git_worktrees') ||
        firstLine.includes('create_git_worktree') ||
        firstLine.includes('inspect_worktree_candidate') ||
        firstLine.includes('discover_verification_plan') ||
        firstLine.includes('git_output') ||
        firstLine.includes('git_repository_root') ||
        firstLine.includes('git_worktrees_for_repository') ||
        firstLine.includes('InspectWorktreeCandidateRequest') ||
        firstLine.includes('CandidateChange') ||
        firstLine.includes('WorktreeCandidateReport') ||
        firstLine.includes('parse_candidate_changes') ||
        firstLine.includes('candidate_risk') ||
        firstLine.includes('candidate_report_for_paths') ||
        firstLine.includes('verification_plan_for_root') ||
        firstLine.includes('VerificationCheck') ||
        firstLine.includes('VerificationPlan') ||
        firstLine.includes('CheckpointRequest') ||
        firstLine.includes('CheckpointResult') ||
        firstLine.includes('checkpoint_script') ||
        firstLine.includes('rollback_script') ||
        firstLine.includes('final_output_line') ||
        firstLine.includes('RollbackRequest') ||
        firstLine.includes('RollbackResult') ||
        firstLine.includes('InstallRequest') ||
        firstLine.includes('InstallResult') ||
        firstLine.includes('PreviewRequest') ||
        firstLine.includes('TunnelRequest') ||
        firstLine.includes('workspace_checkpoint') ||
        firstLine.includes('workspace_rollback') ||
        firstLine.includes('install_dependencies') ||
        firstLine.includes('start_local_preview') ||
        firstLine.includes('start_tunnel')
    ) {
        return 'deployment';
    }

    // Orchestration keywords
    if (firstLine.includes('CreateOrchestrationJobRequest') ||
        firstLine.includes('OrchestrationJobRequest') ||
        firstLine.includes('OrchestrationWorkspaceRequest') ||
        firstLine.includes('OrchestrationJobTransitionRequest') ||
        firstLine.includes('FinishOrchestrationJobRequest') ||
        firstLine.includes('RecordVerificationRequest') ||
        firstLine.includes('RetryOrchestrationJobRequest') ||
        firstLine.includes('DispatchOrchestrationJobRequest') ||
        firstLine.includes('create_orchestration_job') ||
        firstLine.includes('list_orchestration_jobs') ||
        firstLine.includes('list_project_orchestration_jobs') ||
        firstLine.includes('get_orchestration_job') ||
        firstLine.includes('transition_orchestration_job') ||
        firstLine.includes('finish_orchestration_job') ||
        firstLine.includes('retry_orchestration_job') ||
        firstLine.includes('dispatch_orchestration_job') ||
        firstLine.includes('record_verification_result') ||
        firstLine.includes('orchestration_error') ||
        firstLine.includes('background_agent_evidence') ||
        firstLine.includes('orchestration_workspace') ||
        firstLine.includes('AgentRunResult') ||
        firstLine.includes('finish_background_agent') ||
        firstLine.includes('run_background_agent')
    ) {
        return 'orchestration';
    }

    return 'shared';
}

blocks.forEach(block => {
    const cls = classify(block);
    if (cls === 'workspace') workspaceBlocks.push(block);
    else if (cls === 'execution') executionBlocks.push(block);
    else if (cls === 'provider') providerBlocks.push(block);
    else if (cls === 'deployment') deploymentBlocks.push(block);
    else if (cls === 'orchestration') orchestrationBlocks.push(block);
    else if (cls === 'tests') testsBlocks.push(block);
    else sharedBlocks.push(block);
});

console.log(`Classified:
- workspace: ${workspaceBlocks.length}
- execution: ${executionBlocks.length}
- provider: ${providerBlocks.length}
- deployment: ${deploymentBlocks.length}
- orchestration: ${orchestrationBlocks.length}
- tests: ${testsBlocks.length}
- shared: ${sharedBlocks.length}
`);

const commonImports = `use std::{
    path::{Path, PathBuf},
    collections::{HashMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    process::{Command as StdCommand, Stdio},
    sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}, MutexGuard},
    time::{Duration, Instant, UNIX_EPOCH},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{State, WebviewWindow, Manager};
use tokio::{io::AsyncReadExt, process::Command, time::timeout};
use uuid::Uuid;

use crate::orchestrator::{
    CreateJobInput, DurableJobStore, JobAction, JobEvidence, JobMode, JobOutcome, OrchestrationJob,
    OrchestrationJobDetail,
};
use crate::worktrees::{
    is_managed_worktree, managed_worktree_root, parse_worktree_porcelain, validate_git_ref,
    validate_worktree_name, CreateGitWorktreeRequest, GitWorktree,
};

use super::{BackendState, lock, whim_err, record_orchestration_agent_evidence};
use super::{
    MAX_READ_BYTES, MAX_WRITE_BYTES, MAX_PROCESS_OUTPUT_BYTES, MAX_DOTENV_FILE_BYTES,
    MAX_DOTENV_VALUE_BYTES, DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS,
    DEFAULT_DEPLOY_TIMEOUT_MS, MAX_DEPLOY_TIMEOUT_MS,
};
`;

fs.writeFileSync('src-tauri/src/backend/workspace.rs', commonImports + '\n' + workspaceBlocks.join('\n'));
fs.writeFileSync('src-tauri/src/backend/execution.rs', commonImports + '\n' + executionBlocks.join('\n'));
fs.writeFileSync('src-tauri/src/backend/provider.rs', commonImports + '\n' + providerBlocks.join('\n'));
fs.writeFileSync('src-tauri/src/backend/deployment.rs', commonImports + '\n' + deploymentBlocks.join('\n'));
fs.writeFileSync('src-tauri/src/backend/orchestration.rs', commonImports + '\n' + orchestrationBlocks.join('\n'));

if (testsBlocks.length > 0) {
    fs.writeFileSync('src-tauri/src/backend/tests.rs', testsBlocks.join('\n'));
}

// Rewrite mod.rs with correct imports/exports
const modContent = `use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, atomic::AtomicBool, MutexGuard},
};
use crate::orchestrator::DurableJobStore;

pub mod workspace;
pub mod execution;
pub mod provider;
pub mod deployment;
pub mod orchestration;

#[cfg(test)]
mod tests;

// Re-export all Tauri commands so lib.rs remains unchanged
pub use workspace::{
    select_workspace, get_selected_workspace, list_workspace, list_workspace_tree,
    read_workspace_file, write_workspace_file,
};
pub use execution::{
    run_powershell_command, cancel_operation, list_active_operations,
};
pub use provider::{
    discover_credential_names, discover_environment, discover_local_ai_providers,
};
pub use deployment::{
    list_git_worktrees, create_git_worktree, inspect_worktree_candidate,
    discover_verification_plan, deploy_preflight, deploy_workspace,
    workspace_checkpoint, workspace_rollback, install_dependencies,
    start_local_preview, start_tunnel, discover_providers,
};
pub use orchestration::{
    create_orchestration_job, list_orchestration_jobs, list_project_orchestration_jobs,
    get_orchestration_job, transition_orchestration_job, finish_orchestration_job,
    retry_orchestration_job, dispatch_orchestration_job, record_verification_result,
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
    pub(crate) selected_workspace: Mutex<Option<PathBuf>>,
    pub(crate) operations: Mutex<HashMap<String, RunningOperation>>,
    pub(crate) orchestration: Mutex<DurableJobStore>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            selected_workspace: Mutex::new(None),
            operations: Mutex::new(HashMap::new()),
            orchestration: Mutex::new(DurableJobStore::default()),
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

pub(crate) fn lock<'a, T>(mutex: &'a Mutex<T>, label: &str) -> Result<MutexGuard<'a, T>, String> {
    mutex.lock().map_err(|error| {
        let detail = error.to_string();
        format!("A internal resource is locked: {label} ({detail})")
    })
}

pub(crate) fn whim_err(code: &str, detail: &str) -> String {
    format!("WHIM_ERROR: {} - {}", code, detail)
}

pub(crate) fn record_orchestration_agent_evidence(
    state: &BackendState,
    operation_id: &str,
    message: &str,
) {
    let Ok(mut store) = lock(&state.orchestration, "orchestration") else {
        return;
    };
    let _ = store.append_agent_evidence_for_operation(operation_id, message);
}
`;

fs.writeFileSync('src-tauri/src/backend/mod.rs', modContent);
console.log('Split completed successfully.');

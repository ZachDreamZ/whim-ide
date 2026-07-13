mod agent;
mod backend;
mod harness;
mod orchestrator;
mod worktrees;

use backend::BackendState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            backend::orchestration::start_orchestration_worker(app.handle().clone());
            Ok(())
        })
        .manage(BackendState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            backend::workspace::select_workspace,
            backend::workspace::get_selected_workspace,
            backend::workspace::list_workspace,
            backend::workspace::list_workspace_tree,
            backend::workspace::read_workspace_file,
            backend::workspace::write_workspace_file,
            backend::context::capture_app_context,
            backend::voice::transcribe_voice,
            backend::voice::synthesize_voice,
            backend::execution::run_powershell_command,
            backend::execution::cancel_operation,
            backend::execution::list_active_operations,
            backend::provider::discover_environment,
            backend::provider::discover_credential_names,
            backend::provider::discover_local_ai_providers,
            backend::deployment::list_git_worktrees,
            backend::deployment::create_git_worktree,
            backend::deployment::inspect_worktree_candidate,
            backend::deployment::discover_verification_plan,
            backend::deployment::deploy_preflight,
            backend::deployment::deploy_workspace,
            backend::deployment::workspace_checkpoint,
            backend::deployment::workspace_rollback,
            backend::deployment::install_dependencies,
            backend::deployment::start_local_preview,
            backend::deployment::start_tunnel,
            backend::deployment::discover_providers,
            backend::orchestration::create_orchestration_job,
            backend::orchestration::list_orchestration_jobs,
            backend::orchestration::list_project_orchestration_jobs,
            backend::orchestration::get_orchestration_job,
            backend::orchestration::transition_orchestration_job,
            backend::orchestration::finish_orchestration_job,
            backend::orchestration::retry_orchestration_job,
            backend::orchestration::dispatch_orchestration_job,
            backend::orchestration::record_verification_result,
            agent::run_agent_prompt,
            agent::list_provider_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Whim IDE");
}

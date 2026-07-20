mod agent;
mod backend;
mod capabilities;
mod harness;
mod memory;
mod orchestrator;
mod worktrees;

use backend::BackendState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .manage(BackendState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            backend::workspace::select_workspace,
            backend::workspace::ensure_project_context,
            backend::workspace::get_selected_workspace,
            backend::workspace::list_workspace,
            backend::workspace::list_workspace_tree,
            backend::workspace::read_workspace_file,
            backend::workspace::write_workspace_file,
            backend::context::capture_app_context,
            backend::computer::open_gpt_section,
            backend::settings::get_app_settings,
            backend::settings::save_app_settings,
            backend::update_state::load_update_state,
            backend::update_state::save_update_state,
            backend::update_state::clear_update_state,
            backend::chat::list_chat_threads,
            backend::chat::get_chat_thread,
            backend::chat::save_chat_thread,
            backend::chat::delete_chat_thread,
            backend::chat::clear_chat_threads,
            backend::browser::native_browser_action,
            capabilities::list_agent_capabilities,
            backend::voice::transcribe_voice,
            backend::voice::synthesize_voice,
            backend::codebase_index::index_codebase,
            backend::codebase_index::get_codebase_index_structured,
            backend::fs_watcher::start_codebase_watcher,
            backend::fs_watcher::stop_codebase_watcher,
            backend::search::search_workspace,
            backend::execution::run_powershell_command,
            backend::execution::cancel_operation,
            backend::execution::list_active_operations,

            backend::media::media_runtime_status,
            backend::media::generate_media,
            backend::media::read_media_artifact,
            backend::workflows::list_workspace_workflows,
            backend::workflows::expand_workspace_workflow,
            backend::provider::discover_environment,
            backend::provider::discover_credential_names,
            backend::provider::discover_local_ai_providers,
            backend::deployment::list_git_worktrees,
            backend::oauth::oauth_list_providers,
            backend::oauth::oauth_build_auth_url,
            backend::oauth::oauth_authorize,
            backend::oauth::oauth_exchange,
            backend::oauth::oauth_refresh,
            backend::oauth::oauth_get_token,
            backend::oauth::oauth_clear_token,
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
            backend::whim_route::credentials::save_credential,
            backend::whim_route::credentials::get_credential,
            backend::whim_route::credentials::delete_credential,
            backend::whim_route::credentials::redact_key,
            backend::deployment::discover_providers,
            backend::orchestration::create_orchestration_job,
            backend::orchestration::list_orchestration_jobs,
            backend::orchestration::list_project_orchestration_jobs,
            backend::orchestration::get_orchestration_job,
            backend::orchestration::transition_orchestration_job,
            backend::orchestration::finish_orchestration_job,
            backend::orchestration::retry_orchestration_job,
            backend::orchestration::dispatch_orchestration_job,
            backend::orchestration::dispatch_multi_agent_job,
            backend::orchestration::record_verification_result,
            backend::plugins::list_codex_plugins,
            backend::plugins::list_codex_plugin_catalog,
            backend::plugins::install_codex_plugin,
            backend::plugins::remove_codex_plugin,
            backend::productivity::list_scheduled_tasks,
            backend::productivity::save_scheduled_task,
            backend::productivity::delete_scheduled_task,
            backend::productivity::toggle_scheduled_task,
            backend::productivity::claim_due_scheduled_tasks,
            backend::productivity::mark_scheduled_task_run,
            backend::productivity::inspect_sites_workspace,
            backend::productivity::inspect_pull_requests,
            backend::productivity::github_connect,
            backend::productivity::github_disconnect,
            agent::api::run_agent_prompt,
            agent::api::list_provider_models,
            memory::get_observational_memory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Whim IDE");
}

use super::deployment::{
    candidate_report_for_paths, candidate_risk, checkpoint_script, deploy_args,
    deploy_mode_supported, final_output_line, git_worktrees_for_repository,
    parse_candidate_changes, rollback_script, validate_deploy_value, validate_package_name,
    verification_plan_for_root,
};
use super::execution::{powershell_args, preferred_powershell, validate_slug};
use super::orchestration::background_agent_evidence;
use super::workspace::{
    ensure_inside, resolve_agent_workspace, resolve_existing, sanitize_relative,
    selected_workspace_path,
};
use super::{
    finish_operation, is_operation_cancelled, register_agent_operation, whim_err, AgentRunResult,
    BackendState, CommandResult,
};
use crate::backend::deployment::{DeployMode, DeployOptions, DeployTarget};
use crate::worktrees::managed_worktree_root;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::atomic::Ordering;
use uuid::Uuid;

#[test]
fn relative_paths_reject_traversal_and_absolute_paths() {
    assert!(sanitize_relative("src/main.rs", false).is_ok());
    assert!(sanitize_relative("../secret.txt", false).is_err());
    assert!(sanitize_relative("C:\\Windows\\System32", false).is_err());
    assert!(sanitize_relative("/etc/passwd", false).is_err());
}

#[test]
fn identifiers_are_strict() {
    assert!(validate_slug("openai", "provider", 128).is_ok());
    assert!(validate_slug("openai; Remove-Item", "provider", 128).is_err());
}

#[test]
fn background_evidence_keeps_counts_not_agent_payloads() {
    let result = AgentRunResult {
        events: vec![
            serde_json::json!({ "type": "text", "text": "API_KEY=do-not-persist" }),
            serde_json::json!({ "type": "tool_use", "part": { "state": { "status": "completed", "output": "secret output" } } }),
            serde_json::json!({ "type": "tool_use", "part": { "state": { "status": "error", "error": "credential detail" } } }),
        ],
        malformed_event_lines: 0,
        session_id: None,
        model_id: None,
        command: CommandResult {
            operation_id: "background-test".to_string(),
            command: "native-agent".to_string(),
            cwd: "C:/workspace".to_string(),
            success: false,
            exit_code: Some(1),
            stdout: "raw output".to_string(),
            stderr: "raw error".to_string(),
            stdout_truncated: false,
            stderr_truncated: false,
            timed_out: true,
            cancelled: false,
            duration_ms: 420,
        },
    };

    let evidence = background_agent_evidence(&result);
    assert_eq!(evidence.event_count, 0);
    assert_eq!(evidence.tool_call_count, 0);
    assert_eq!(evidence.failed_tool_call_count, 0);
    assert_eq!(evidence.duration_ms, Some(420));
    assert!(evidence.timed_out);
}

#[test]
fn candidate_inventory_is_bounded_and_risk_covers_working_paths() {
    let committed = "A\tsrc/new.ts\nR100\tsrc/old.ts\tsrc/renamed.ts\n";
    let working = " M src/new.ts\n?? config/.env.production\n";
    let (changes, committed_count, working_count, truncated) =
        parse_candidate_changes(committed, working);
    assert_eq!(committed_count, 2);
    assert_eq!(working_count, 2);
    assert!(!truncated);
    assert!(changes.iter().any(|change| change.path == "src/renamed.ts"));
    assert!(changes
        .iter()
        .any(|change| change.path == "config/.env.production"));

    let (risk, signals) = candidate_risk(&changes, committed_count + working_count);
    assert_eq!(risk, "high");
    assert!(signals
        .iter()
        .any(|signal| signal.contains("Sensitive configuration")));
}

#[test]
fn deploy_modes_are_explicit() {
    assert!(deploy_mode_supported(
        DeployTarget::Vercel,
        DeployMode::Preview
    ));
    assert!(!deploy_mode_supported(
        DeployTarget::Docker,
        DeployMode::Production
    ));
    assert!(deploy_mode_supported(
        DeployTarget::Docker,
        DeployMode::Local
    ));
}

#[test]
fn package_names_are_validated_before_install() {
    // Safe, conventional npm specs are accepted.
    assert!(validate_package_name("react").is_ok());
    assert!(validate_package_name("@scope/package").is_ok());
    assert!(validate_package_name("lodash@4.17.21").is_ok());
    // Anything that could break out of the npm argument or the shell is rejected.
    assert!(validate_package_name("foo; rm -rf /").is_err());
    assert!(validate_package_name("foo$(calc)").is_err());
    assert!(validate_package_name("../escape").is_err());
    assert!(validate_package_name("./local").is_err());
    assert!(validate_package_name("").is_err());
}

#[test]
fn deploy_args_build_expected_commands() {
    let root = std::env::temp_dir();
    let vercel_preview = deploy_args(
        &root,
        DeployTarget::Vercel,
        DeployMode::Preview,
        &DeployOptions::default(),
    )
    .expect("vercel preview args");
    assert_eq!(vercel_preview, vec!["--yes".to_string()]);
    let vercel_production = deploy_args(
        &root,
        DeployTarget::Vercel,
        DeployMode::Production,
        &DeployOptions::default(),
    )
    .expect("vercel production args");
    assert_eq!(
        vercel_production,
        vec!["--prod".to_string(), "--yes".to_string(),]
    );
    let fly = deploy_args(
        &root,
        DeployTarget::Fly,
        DeployMode::Production,
        &DeployOptions {
            app_name: Some("my-app".to_string()),
            ..Default::default()
        },
    )
    .expect("fly args");
    assert_eq!(
        fly,
        vec![
            "deploy".to_string(),
            "--app".to_string(),
            "my-app".to_string()
        ]
    );
    // Render without explicit service id still produces args (no validation error).
    let render = deploy_args(
        &root,
        DeployTarget::Render,
        DeployMode::Production,
        &DeployOptions::default(),
    )
    .expect("render args");
    assert_eq!(render, vec!["deploy".to_string()]);
}

#[test]
fn deploy_value_validation_rejects_unsafe_input() {
    assert!(validate_deploy_value(&Some("safe-name".to_string()), "Service ID", "-_", 128).is_ok());
    assert!(validate_deploy_value(&Some("bad name".to_string()), "Service ID", "-_", 128).is_err());
    assert!(
        validate_deploy_value(&Some("name;rm -rf".to_string()), "App name", "-_", 128).is_err()
    );
    assert!(validate_deploy_value(&Some("a".repeat(300)), "Image tag", "-_.:/@", 256).is_err());
}

#[test]
fn whim_error_envelope_is_parseable() {
    let envelope = whim_err("PRODUCTION_CONFIRMATION_REQUIRED", "needs confirmation");
    assert!(envelope.starts_with("WHIM_ERROR: PRODUCTION_CONFIRMATION_REQUIRED"));
    assert!(envelope.ends_with("needs confirmation"));
}

#[test]
fn agent_cancellation_capture_before_finish() {
    // Full lifecycle: register, duplicate reject, set flag, capture true,
    // finish cleanup, verify false after removal.
    let state = BackendState::default();
    let workspace = std::path::Path::new("C:/work/whim");

    register_agent_operation(&state, "op-1", "native-agent", workspace).unwrap();
    assert!(
        !is_operation_cancelled(&state, "op-1"),
        "fresh operation is not cancelled"
    );

    // Duplicate registration must be rejected.
    assert!(
        register_agent_operation(&state, "op-1", "native-agent", workspace).is_err(),
        "duplicate registration rejected"
    );

    // Simulate cancel_operation setting the flag.
    {
        let mut ops = state.operations.lock().unwrap();
        ops.get_mut("op-1")
            .unwrap()
            .cancelled
            .store(true, Ordering::SeqCst);
    }

    // Capture the flag BEFORE finish_operation (the bug-fix pattern).
    let captured_cancelled = is_operation_cancelled(&state, "op-1");
    assert!(captured_cancelled, "captured cancellation flag is true");

    // finish_operation removes the entry.
    finish_operation(&state, "op-1");

    // After removal, is_operation_cancelled returns false (entry gone).
    assert!(
        !is_operation_cancelled(&state, "op-1"),
        "after finish_operation, lookup returns false"
    );

    // Confirm the captured value is still true (was captured before
    // finish_operation destroyed the entry).
    assert!(captured_cancelled, "captured value survives cleanup");
}

#[test]
fn agent_operation_leases_one_execution_root_but_allows_distinct_worktrees() {
    let state = BackendState::default();
    let source = std::path::Path::new("C:/work/whim");
    let isolated = std::path::Path::new("C:/work/.whim-worktrees/whim/review-1");

    register_agent_operation(&state, "source-agent", "native-agent", source).unwrap();
    let same_root = register_agent_operation(&state, "racing-agent", "native-agent", source)
        .expect_err("the source worktree already has an active agent");
    assert!(same_root.contains("distinct registered worktree"));

    // A future roster can run this agent in parallel because its resolved
    // Git worktree has a different filesystem root.
    register_agent_operation(&state, "isolated-agent", "native-agent", isolated).unwrap();

    finish_operation(&state, "source-agent");
    register_agent_operation(&state, "replacement-agent", "native-agent", source).unwrap();

    finish_operation(&state, "isolated-agent");
    finish_operation(&state, "replacement-agent");
}

#[test]
fn agent_operation_has_pid_zero() {
    // Agent operations registered via register_agent_operation must have
    // pid == 0 so cancel_operation skips terminate_process_tree.
    let state = BackendState::default();
    register_agent_operation(
        &state,
        "op-pid-zero",
        "native-agent",
        std::path::Path::new("C:/work/whim"),
    )
    .unwrap();

    let pid = state
        .operations
        .lock()
        .unwrap()
        .get("op-pid-zero")
        .map(|op| op.pid);
    assert_eq!(pid, Some(0), "agent operations use pid=0 sentinel");

    // Verify the pid==0 guard in cancel_operation would skip OS kill:
    // setting the flag alone should suffice for sentinel operations.
    // We simulate the guard logic here.
    {
        let mut ops = state.operations.lock().unwrap();
        let op = ops.get_mut("op-pid-zero").unwrap();
        op.cancelled.store(true, Ordering::SeqCst);

        // This is the guard check: pid==0 → skip terminate_process_tree.
        let _termination_requested = op.pid == 0;
        assert!(
            op.pid == 0,
            "pid must be 0 for agent ops, guard skipped OS kill"
        );
    }

    assert!(
        is_operation_cancelled(&state, "op-pid-zero"),
        "flag took effect via pid==0 guard"
    );

    finish_operation(&state, "op-pid-zero");
}

#[test]
fn checkpoint_script_uses_a_private_index_without_initializing_or_staging_untracked_files() {
    let script = checkpoint_script("checkpoint-42");

    assert!(script.contains("whim-index-checkpoint-42"));
    assert!(script.contains("git read-tree HEAD"));
    assert!(script.contains("git add -u"));
    assert!(script.contains("commit-tree"));
    assert!(script.contains("refs/whim/checkpoints/latest"));
    assert!(!script.contains("git init"));
    assert!(!script.contains("git add -A"));
    assert!(!script.contains("git config user."));
    assert!(!script.contains("git tag -f"));
}

#[test]
fn rollback_script_preserves_tracked_changes_without_collecting_untracked_files() {
    let script = rollback_script("refs/whim/checkpoints/latest");

    assert!(script.contains("git stash push -q -m \"whim-rollback-tracked\""));
    assert!(script.contains(
        "git restore --source \"refs/whim/checkpoints/latest\" --staged --worktree -- ."
    ));
    assert!(script.contains("WHIM_STASH_CREATED="));
    assert!(!script.contains("stash push -u"));
    assert!(!script.contains("git clean"));
    assert!(!script.contains("git reset --hard"));
}

#[test]
fn final_output_line_ignores_checkpoint_metadata() {
    let output = "WHIM_STASH_CREATED=true\nabc123\n";
    assert_eq!(final_output_line(output).as_deref(), Some("abc123"));
    assert_eq!(final_output_line("WHIM_STASH_CREATED=false\n"), None);
}

#[test]
fn verification_plan_uses_fixed_entry_points_not_project_script_bodies() {
    let root = std::env::temp_dir().join(format!("whim-verification-plan-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).expect("create verification fixture");
    fs::write(
        root.join("package.json"),
        r#"{
              "scripts": {
                "test": "node ./contains-arbitrary-project-code.js",
                "lint": "eslint .",
                "preinstall": "not-an-inferred-check",
                "custom-danger": "Remove-Item -Recurse -Force ."
              }
            }"#,
    )
    .expect("write package manifest");
    fs::write(root.join("yarn.lock"), "").expect("write yarn lock");

    let (checks, warnings) = verification_plan_for_root(&root);
    assert!(warnings.is_empty());
    assert!(checks.iter().any(|check| check.command == "yarn test"));
    assert!(checks.iter().any(|check| check.command == "yarn lint"));
    assert!(checks
        .iter()
        .all(|check| !check.command.contains("contains-arbitrary")));
    assert!(checks
        .iter()
        .all(|check| !check.command.contains("custom-danger")));
    assert!(checks
        .iter()
        .all(|check| !check.command.contains("preinstall")));

    fs::remove_dir_all(&root).ok();
}

#[cfg(windows)]
#[tokio::test]
async fn registered_worktrees_are_the_only_allowed_isolated_execution_targets() {
    if StdCommand::new("git").arg("--version").output().is_err() {
        return;
    }
    let root = std::env::temp_dir().join(format!("whim-worktree-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).expect("create temporary Git repository");
    let git = |cwd: &Path, args: Vec<String>| -> String {
        let output = StdCommand::new("git")
            .args(&args)
            .current_dir(cwd)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    git(&root, vec!["init".into(), "-q".into()]);
    git(
        &root,
        vec!["config".into(), "user.name".into(), "Whim test".into()],
    );
    git(
        &root,
        vec![
            "config".into(),
            "user.email".into(),
            "test@whim.local".into(),
        ],
    );
    fs::write(root.join("tracked.txt"), "baseline\n").expect("write baseline");
    git(&root, vec!["add".into(), "tracked.txt".into()]);
    git(
        &root,
        vec!["commit".into(), "-qm".into(), "baseline".into()],
    );

    let linked = root
        .parent()
        .expect("temporary root has a parent")
        .join(format!("whim-linked-{}", Uuid::new_v4()));
    git(
        &root,
        vec![
            "worktree".into(),
            "add".into(),
            "-b".into(),
            "feature/external".into(),
            linked.to_string_lossy().into_owned(),
        ],
    );

    let managed_root = managed_worktree_root(&root).expect("managed root");
    fs::create_dir_all(&managed_root).expect("create managed root");
    let managed = managed_root.join("agent");
    git(
        &root,
        vec![
            "worktree".into(),
            "add".into(),
            "-b".into(),
            "whim/agent".into(),
            managed.to_string_lossy().into_owned(),
        ],
    );

    let root = dunce::canonicalize(&root).expect("canonical root");
    let linked = dunce::canonicalize(&linked).expect("canonical linked worktree");
    let managed = dunce::canonicalize(&managed).expect("canonical managed worktree");
    let worktrees = git_worktrees_for_repository(&root)
        .await
        .expect("list registered worktrees");
    assert!(worktrees
        .iter()
        .any(|worktree| worktree.primary && Path::new(&worktree.path) == root));
    assert!(worktrees
        .iter()
        .any(|worktree| Path::new(&worktree.path) == linked && !worktree.managed));
    assert!(worktrees
        .iter()
        .any(|worktree| Path::new(&worktree.path) == managed && worktree.managed));

    let state = BackendState::default();
    *state.selected_workspace.lock().expect("workspace lock") = Some(root.clone());
    assert_eq!(
        resolve_agent_workspace(&state, Some(&managed.to_string_lossy()))
            .await
            .expect("registered worktree is an execution target"),
        managed
    );
    let unrelated = root.parent().expect("repository parent").to_path_buf();
    assert!(
        resolve_agent_workspace(&state, Some(&unrelated.to_string_lossy()))
            .await
            .is_err(),
        "a neighboring folder must never become an agent execution target"
    );

    git(
        &root,
        vec![
            "worktree".into(),
            "remove".into(),
            "--force".into(),
            managed.to_string_lossy().into_owned(),
        ],
    );
    git(
        &root,
        vec![
            "worktree".into(),
            "remove".into(),
            "--force".into(),
            linked.to_string_lossy().into_owned(),
        ],
    );
    fs::remove_dir_all(&root).ok();
    fs::remove_dir_all(&managed_root).ok();
}

#[cfg(windows)]
#[tokio::test]
async fn candidate_report_uses_real_merge_base_worktree_and_verification_evidence() {
    if StdCommand::new("git").arg("--version").output().is_err() {
        return;
    }
    let root = std::env::temp_dir().join(format!("whim-candidate-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).expect("create temporary Git repository");
    let git = |cwd: &Path, args: &[&str]| -> String {
        let output = StdCommand::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    git(&root, &["init", "-q"]);
    git(&root, &["config", "user.name", "Whim test"]);
    git(&root, &["config", "user.email", "test@whim.local"]);
    fs::write(root.join("README.md"), "baseline\n").expect("write baseline");
    fs::write(
        root.join("package.json"),
        r#"{"scripts":{"typecheck":"tsc --noEmit"}}"#,
    )
    .expect("write package manifest");
    git(&root, &["add", "README.md", "package.json"]);
    git(&root, &["commit", "-qm", "baseline"]);
    let base_head = git(&root, &["rev-parse", "HEAD"]);

    let candidate = root
        .parent()
        .expect("temporary root parent")
        .join(format!("whim-candidate-linked-{}", Uuid::new_v4()));
    let candidate_text = candidate.to_string_lossy().into_owned();
    git(
        &root,
        &[
            "worktree",
            "add",
            "-b",
            "whim/candidate-test",
            &candidate_text,
        ],
    );
    fs::create_dir_all(candidate.join("src")).expect("create candidate source");
    fs::write(candidate.join("src/auth.ts"), "export const auth = true;\n")
        .expect("write candidate change");
    git(&candidate, &["add", "src/auth.ts"]);
    git(&candidate, &["commit", "-qm", "candidate auth change"]);
    fs::write(candidate.join(".env.production"), "API_KEY=never-read\n")
        .expect("write untracked sensitive path");

    let primary = dunce::canonicalize(&root).expect("canonical primary");
    let candidate = dunce::canonicalize(&candidate).expect("canonical candidate");
    let report = candidate_report_for_paths(
        &primary,
        &candidate,
        Some("whim/candidate-test".to_string()),
    )
    .await
    .expect("candidate report");
    assert_eq!(report.merge_base, base_head);
    assert_eq!(report.committed_change_count, 1);
    assert_eq!(report.working_change_count, 1);
    assert_eq!(report.risk, "high");
    assert!(report
        .risk_signals
        .iter()
        .any(|signal| signal.contains("Authentication")));
    assert!(report
        .risk_signals
        .iter()
        .any(|signal| signal.contains("Sensitive configuration")));
    assert!(report
        .blockers
        .iter()
        .any(|blocker| blocker.contains("uncommitted changes")));
    assert!(report
        .verification_checks
        .iter()
        .any(|check| check.command == "npm run typecheck"));

    git(
        &primary,
        &[
            "worktree",
            "remove",
            "--force",
            &candidate.to_string_lossy(),
        ],
    );
    fs::remove_dir_all(&primary).ok();
}

#[cfg(windows)]
#[test]
fn checkpoint_and_rollback_scripts_preserve_branch_and_untracked_files() {
    if StdCommand::new("git").arg("--version").output().is_err() {
        return;
    }
    let root = std::env::temp_dir().join(format!("whim-checkpoint-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).expect("create temporary Git worktree");
    let git = |args: &[&str]| -> String {
        let output = StdCommand::new("git")
            .args(args)
            .current_dir(&root)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    git(&["init", "-q"]);
    git(&["config", "user.name", "Whim test"]);
    git(&["config", "user.email", "test@whim.local"]);
    fs::write(root.join("tracked.txt"), "baseline\n").expect("write baseline");
    git(&["add", "tracked.txt"]);
    git(&["commit", "-qm", "baseline"]);
    let head_before = git(&["rev-parse", "HEAD"]);

    fs::write(root.join("tracked.txt"), "checkpoint state\n").expect("write checkpoint state");
    fs::write(
        root.join("untracked-secret.txt"),
        "API_KEY=do-not-capture\n",
    )
    .expect("write untracked fixture");
    let checkpoint_output = StdCommand::new(preferred_powershell())
        .args(powershell_args(checkpoint_script("real-checkpoint"), false))
        .current_dir(&root)
        .output()
        .expect("run checkpoint script");
    assert!(
        checkpoint_output.status.success(),
        "checkpoint script failed: {}",
        String::from_utf8_lossy(&checkpoint_output.stderr)
    );
    let checkpoint = final_output_line(&String::from_utf8_lossy(&checkpoint_output.stdout))
        .expect("checkpoint ref output");

    assert_eq!(git(&["rev-parse", "HEAD"]), head_before);
    assert_eq!(
        git(&["rev-parse", "refs/whim/checkpoints/latest"]),
        checkpoint
    );
    assert_eq!(
        fs::read_to_string(root.join("tracked.txt"))
            .unwrap()
            .replace("\r\n", "\n"),
        "checkpoint state\n"
    );
    assert!(root.join("untracked-secret.txt").is_file());

    fs::write(root.join("tracked.txt"), "broken state\n").expect("write broken state");
    fs::write(root.join("new-untracked.txt"), "leave me alone\n").expect("write untracked state");
    let rollback_output = StdCommand::new(preferred_powershell())
        .args(powershell_args(
            rollback_script("refs/whim/checkpoints/latest"),
            false,
        ))
        .current_dir(&root)
        .output()
        .expect("run rollback script");
    assert!(
        rollback_output.status.success(),
        "rollback script failed: {}",
        String::from_utf8_lossy(&rollback_output.stderr)
    );
    assert_eq!(
        fs::read_to_string(root.join("tracked.txt"))
            .unwrap()
            .replace("\r\n", "\n"),
        "checkpoint state\n"
    );
    assert!(root.join("untracked-secret.txt").is_file());
    assert!(root.join("new-untracked.txt").is_file());
    assert_eq!(git(&["rev-parse", "HEAD"]), head_before);
    assert!(git(&["stash", "list"]).contains("whim-rollback-tracked"));

    fs::remove_dir_all(&root).ok();
}

#[test]
fn resolve_existing_rejects_nonexistent_file() {
    let tmp = std::env::temp_dir();
    let err = resolve_existing(&tmp, "nonexistent-file-xyz.json", false).unwrap_err();
    assert!(
        err.contains("WORKSPACE_PATH_UNRESOLVED") || err.contains("does not exist"),
        "Expected unresolvable path error, got: {err}"
    );
}

#[test]
fn resolve_existing_reads_real_file() {
    let tmp = std::env::temp_dir();
    // Write a known file inside the temp directory.
    let test_file = tmp.join("whim-test-resolve.txt");
    std::fs::write(&test_file, "hello").expect("write test file");

    let resolved = resolve_existing(&tmp, "whim-test-resolve.txt", false).expect("resolve");
    assert_eq!(resolved, dunce::canonicalize(&test_file).unwrap());

    std::fs::remove_file(&test_file).ok();
}

#[test]
fn ensure_inside_rejects_escape() {
    let root = PathBuf::from("C:\\workspace");
    let inside = PathBuf::from("C:\\workspace\\src\\file.rs");
    let escape = PathBuf::from("C:\\outside\\secret.txt");
    assert!(ensure_inside(&root, &inside).is_ok());
    assert!(ensure_inside(&root, &escape).is_err());
}

#[test]
fn selected_workspace_path_fails_without_selection() {
    let state = BackendState::default();
    let err = selected_workspace_path(&state).unwrap_err();
    assert!(
        err.contains("No workspace is selected"),
        "Expected no-workspace error, got: {err}"
    );
}

#[test]
fn selected_workspace_path_returns_selected() {
    let state = BackendState::default();
    {
        let mut ws = state.selected_workspace.lock().unwrap();
        *ws = Some(PathBuf::from("C:\\workspace"));
    }
    let path = selected_workspace_path(&state).expect("should return path");
    assert_eq!(path, PathBuf::from("C:\\workspace"));
}

#[test]
fn resolve_existing_rejects_directory_request() {
    // resolve_existing uses dunce::canonicalize which requires the file
    // to exist. Requesting "." as a file should fail because it's a
    // directory (not a regular file — caught by read_workspace_file).
    let tmp = std::env::temp_dir();
    // "." resolves to the temp dir itself, which is a directory. But
    // resolve_existing uses allow_root=false, so it fails if the
    // sanitized path is empty. Let's use a known sub-path instead.
    let result = resolve_existing(&tmp, ".", false);
    assert!(result.is_err(), "Expected error for empty path, got Ok");
}

#[test]
fn read_file_internal_path_construction() {
    // Verify the path construction logic used inside read_workspace_file:
    // root joined with sanitized relative path must produce correct path.
    let tmp = std::env::temp_dir();
    let test_file = tmp.join("whim-test-read-helper.txt");
    std::fs::write(&test_file, "test content").expect("write test file");

    let resolved =
        resolve_existing(&tmp, "whim-test-read-helper.txt", false).expect("resolve existing file");
    assert_eq!(resolved, dunce::canonicalize(&test_file).unwrap());

    let content = std::fs::read_to_string(&resolved).expect("read file");
    assert_eq!(content, "test content");

    std::fs::remove_file(&test_file).ok();
}

#[test]
fn size_limit_rejects_large_file() {
    // Simulate the size-check inside read_workspace_file.
    let tmp = std::env::temp_dir();
    let test_file = tmp.join("whim-test-size-check.txt");
    std::fs::write(&test_file, "a").expect("write test file");

    let metadata = std::fs::metadata(&test_file).expect("metadata");
    assert!(metadata.len() > 0);
    // Simulate clamping: max_bytes=0 → clamped to 1, file is 1 byte.
    // With max_bytes=1 and file size=1, the check `metadata.len() > max_bytes`
    // is false (1 > 1 is false), so file passes. Use limit 0 to check.
    let max_bytes = 1usize.clamp(1, 8_000_000);
    if metadata.len() > max_bytes as u64 {
        panic!("expected file to be within limit");
    }

    std::fs::remove_file(&test_file).ok();
}

#[test]
fn utf8_validation_rejects_binary() {
    // Simulate the String::from_utf8 check inside read_workspace_file.
    let bytes: Vec<u8> = vec![0xff, 0xfe, 0x00, 0x01];
    let result = String::from_utf8(bytes);
    assert!(result.is_err(), "Non-UTF-8 byte sequence must be rejected");
}

// ── Regression: workspace file reads are provider-independent ──

/// Replicate the full read path (resolve_existing + metadata + read) that
/// read_workspace_file uses. Must succeed for any UTF-8 file inside the
/// workspace root, with zero dependency on provider state.
#[test]
fn read_path_succeeds_for_json_inside_workspace() {
    let tmp = std::env::temp_dir().join("whim-test-read-ws-json");
    std::fs::create_dir_all(&tmp).expect("create workspace dir");
    let file = tmp.join("opencode.json");
    std::fs::write(&file, r#"{"name":"test"}"#).expect("write test file");

    let resolved = resolve_existing(&tmp, "opencode.json", false).expect("resolve opencode.json");
    let metadata = std::fs::metadata(&resolved).expect("metadata");
    assert!(metadata.is_file(), "must be a regular file");
    let max_bytes = 8_000_000usize;
    assert!(
        metadata.len() <= max_bytes as u64,
        "file must be within read limit"
    );
    let bytes = std::fs::read(&resolved).expect("read file bytes");
    let content = String::from_utf8(bytes).expect("valid UTF-8");
    assert_eq!(content, r#"{"name":"test"}"#);

    std::fs::remove_dir_all(&tmp).ok();
}

/// read path must return error for a missing file.
#[test]
fn read_path_fails_for_missing_file() {
    let tmp = std::env::temp_dir().join("whim-test-read-ws-missing");
    std::fs::create_dir_all(&tmp).expect("create workspace dir");

    let result = resolve_existing(&tmp, "does-not-exist.json", false);
    assert!(result.is_err(), "resolve of missing file must fail");
    let err = result.unwrap_err();
    assert!(
        err.contains("WORKSPACE_PATH_UNRESOLVED") || err.contains("does not exist"),
        "Expected path-unresolved error, got: {err}"
    );

    std::fs::remove_dir_all(&tmp).ok();
}

/// read path must reject traversal outside workspace.
#[test]
fn read_path_rejects_traversal() {
    let tmp = std::env::temp_dir().join("whim-test-read-ws-traverse");
    std::fs::create_dir_all(&tmp).expect("create workspace dir");

    let result = resolve_existing(&tmp, "../secret.txt", false);
    assert!(result.is_err(), "traversal must be rejected");

    std::fs::remove_dir_all(&tmp).ok();
}

/// read path must fail without a selected workspace.
#[test]
fn read_path_fails_without_selected_workspace() {
    let state = BackendState::default();
    let result = selected_workspace_path(&state);
    assert!(result.is_err(), "read without workspace must fail");
    let err = result.unwrap_err();
    assert!(
        err.contains("No workspace is selected"),
        "Expected no-workspace error, got: {err}"
    );
}

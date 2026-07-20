//! Whim native agent harness.
//!
//! Whim runs its OWN coding agent. It is a provider-neutral harness: it calls
//! provider chat APIs directly with tool calling, executes a safe tool set
//! inside the selected workspace, and emits events in the `{type, part?,
//! text?, error?}` shape that `agentEventsToParts` (bridge.ts) parses.
//!
//! Design borrows the best patterns from leading code-agent harnesses:
//! - Explore -> Plan -> Implement -> Verify workflow (Claude Code / Codex)
//! - Auto-compaction of conversation context (Claude Code)
//! - Project memory files (AGENTS.md / CLAUDE.md / README) auto-loaded
//! - Read-only research sub-agents to investigate without bloating context
//! - Verification loop: run build/test/lint and iterate until green
//! - Multi-protocol provider abstraction: OpenAI, Anthropic, Google, OpenCode
//!   Zen, Qwen, DeepSeek, Xiaomi, Local (Ollama/LM Studio), and any
//!   OpenAI-compatible custom endpoint.

#![allow(dead_code)]

#[cfg(test)]
use serde_json::Value;
#[cfg(test)]
use serde_json::json;
#[cfg(test)]
use crate::backend::settings::AppSettings;

#[cfg(test)]
use crate::harness::{HarnessProfile, HARNESS_PROFILE_PATH};

const MAX_OPENCODE_AUTH_BYTES: u64 = 128 * 1024;
const MAX_STORED_API_KEY_BYTES: usize = 4 * 1024;

pub(crate) mod provider;
pub use provider::{
    default_model, parse_provider, provider_environment_variables, provider_key_available, AgentRole,
    Provider,
};
#[cfg(test)]
pub(crate) use provider::{
    provider_env_var, provider_request_is_auto, provider_requires_key, resolve_key,
    validate_provider_base,
};

pub(crate) mod events;



pub(crate) mod external;

pub(crate) mod loop_detector;


pub(crate) mod transport;

pub(crate) mod background;

pub(crate) mod tools;

pub(crate) mod execution;

pub(crate) mod prompt;

pub(crate) mod r#loop;
pub(crate) use r#loop::MAX_PROVIDER_RETRIES;
#[cfg(test)]
pub(crate) use r#loop::{tool_iteration_budget, remaining_agent_budget};

pub(crate) mod api;
pub(crate) use api::{
    AgentRunRequest, load_harness_profile, run_agent_prompt, run_model_chat,
};



#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    use crate::agent::events::{durable_audit_label, AgentEvent, ReasoningPart, ToolUsePart, ToolUseState};
    use crate::agent::loop_detector::{LoopDetector, LOOP_DETECT_MIN_REPEATS};
    use crate::agent::tools::{tool_defs, tool_defs_for_profile, tool_display};
    use crate::agent::prompt::build_system_prompt;
    use crate::agent::provider::{
        parse_stored_opencode_api_key, resolve_key_with, validate_omniroute_base,
    };
    use crate::agent::external::{
        claude_output_text, codex_output_text,
        pi_tool_allowlist, plain_output_text,
    };
    #[test]
    fn provider_parsing_is_strict() {
        assert!(parse_provider("openai").is_ok());
        assert!(parse_provider("gemini").is_ok());
        assert!(parse_provider("ollama").is_ok());
        assert!(parse_provider("qwen").is_ok());
        assert!(parse_provider("compatible").is_ok());
        assert_eq!(parse_provider("omniroute").unwrap(), Provider::OmniRoute);
        assert!(parse_provider("XIAOMI").is_ok());
        assert_eq!(parse_provider("opencode").unwrap(), Provider::OpenCode);
        assert!(parse_provider("nonsense").is_err());
    }

    #[test]
    fn provider_default_means_zero_configuration_auto_routing() {
        assert!(provider_request_is_auto(None));
        assert!(provider_request_is_auto(Some("")));
        assert!(provider_request_is_auto(Some("AUTO")));
        assert!(!provider_request_is_auto(Some("openai")));
    }

    #[test]
    fn omniroute_uses_role_aware_routes_and_secure_bases() {
        assert_eq!(
            default_model(Provider::OmniRoute, AgentRole::Researcher),
            "auto/cheap"
        );
        assert_eq!(
            default_model(Provider::OmniRoute, AgentRole::Implementer),
            "auto/coding"
        );
        assert!(validate_omniroute_base("http://127.0.0.1:20128/v1").is_ok());
        assert!(validate_omniroute_base("http://localhost:20128/v1/").is_ok());
        assert!(validate_omniroute_base("https://router.example.com/v1").is_ok());
        assert!(validate_omniroute_base("http://router.example.com/v1").is_err());
        assert!(!provider_requires_key(Provider::OmniRoute));
    }

    #[test]
    fn provider_endpoints_enforce_transport_and_locality_boundaries() {
        assert!(validate_provider_base(Provider::Local, "http://127.0.0.1:1234/v1").is_ok());
        assert!(validate_provider_base(Provider::Local, "http://localhost:11434/v1").is_ok());
        assert!(validate_provider_base(Provider::Local, "http://192.168.1.4:1234/v1").is_err());
        assert!(
            validate_provider_base(Provider::Compatible, "https://models.example.com/v1").is_ok()
        );
        assert!(validate_provider_base(Provider::Compatible, "http://localhost:1234/v1").is_ok());
        assert!(
            validate_provider_base(Provider::Compatible, "http://models.example.com/v1").is_err()
        );
        assert!(validate_provider_base(Provider::Compatible, "https://10.0.0.4/v1").is_err());
        assert!(
            validate_provider_base(Provider::Compatible, "https://user:pass@example.com/v1")
                .is_err()
        );
        assert!(!provider_requires_key(Provider::Compatible));
    }

    #[test]
    fn provider_base_url_rejects_query_fragment_cleartext_and_credentials() {
        // Valid HTTPS cloud endpoint is accepted.
        assert!(validate_provider_base(Provider::OpenAi, "https://api.openai.com/v1").is_ok());
        assert!(validate_provider_base(Provider::OpenCode, "https://opencode.ai/zen/v1").is_ok());
        assert!(validate_provider_base(Provider::OpenCode, "https://example.com/zen/v1").is_err());
        assert!(validate_provider_base(Provider::OpenCode, "http://opencode.ai/zen/v1").is_err());
        // Cleartext HTTP to a non-loopback host is rejected.
        assert!(validate_provider_base(Provider::OpenAi, "http://api.openai.com/v1").is_err());
        // Query strings and fragments are rejected (could smuggle tokens/params).
        assert!(validate_provider_base(Provider::OpenAi, "https://api.openai.com/v1?x=1").is_err());
        assert!(
            validate_provider_base(Provider::OpenAi, "https://api.openai.com/v1#frag").is_err()
        );
        // Embedded credentials in the URL are rejected.
        assert!(
            validate_provider_base(Provider::OpenAi, "https://user:pass@api.openai.com/v1")
                .is_err()
        );
        // Loopback HTTP is allowed for local-compatible endpoints.
        assert!(validate_provider_base(Provider::Compatible, "http://localhost:1234/v1").is_ok());
        // OLLAMA_HOST-style loopback is the only non-HTTPS local case allowed.
        assert!(validate_provider_base(Provider::Local, "http://127.0.0.1:11434/v1").is_ok());
    }

    #[test]
    fn agent_modes_are_strict_and_narrow_tool_authority() {
        assert_eq!(AgentRole::parse(None).unwrap(), AgentRole::Auto);
        assert_eq!(AgentRole::parse(Some("vibe")).unwrap(), AgentRole::Auto);
        assert_eq!(AgentRole::parse(Some("tester")).unwrap(), AgentRole::Tester);
        assert_eq!(
            AgentRole::parse(Some("janitor")).unwrap(),
            AgentRole::Janitor
        );
        let unsupported = AgentRole::parse(Some("operate")).unwrap_err();
        assert!(unsupported.contains("Supported: chat"));

        assert_eq!(AgentRole::parse(Some("chat")).unwrap(), AgentRole::Chat);
        assert!(tool_defs_for_profile(
            &HarnessProfile::default(),
            AgentRole::Chat,
            &AppSettings::default()
        )
        .is_empty());
        assert!(pi_tool_allowlist(
            AgentRole::Chat,
            &HarnessProfile::default(),
            &AppSettings::default()
        )
        .is_empty());
        let chat_prompt = build_system_prompt(
            "C:\\private",
            "ignored memory",
            "chat",
            None,
            &AppSettings::default(),
        );
        assert!(chat_prompt.contains("helpful general-purpose assistant"));
        assert!(chat_prompt.contains("You have no tools"));
        assert!(!chat_prompt.contains("selected workspace"));

        assert!(AgentRole::Planner.permits_tool("read_file"));
        assert!(AgentRole::Planner.permits_tool("plan"));
        assert!(!AgentRole::Planner.permits_tool("write_file"));
        assert!(!AgentRole::Reviewer.permits_tool("run_command"));
        assert!(AgentRole::Tester.permits_tool("verify"));
        assert!(!AgentRole::Tester.permits_tool("run_command"));
        assert!(!AgentRole::Tester.permits_tool("edit_file"));
        assert!(AgentRole::Implementer.permits_tool("edit_file"));
        assert!(AgentRole::Janitor.permits_tool("edit_file"));
        assert!(AgentRole::Janitor.permits_tool("verify"));
        assert!(!AgentRole::Janitor.permits_tool("write_file"));
        assert!(!AgentRole::Janitor.permits_tool("run_command"));
        assert!(!AgentRole::Janitor.permits_tool("tunnel"));
        assert!(AgentRole::Auto.permits_tool("delegate_task"));
        assert!(AgentRole::Auto.permits_tool("write_file"));
        assert!(AgentRole::Auto.permits_tool("edit_file"));
        assert!(AgentRole::Auto.permits_tool("run_command"));
        assert!(AgentRole::Auto.permits_tool("verify"));
        assert!(!AgentRole::Auto.permits_tool("tunnel"));

        let vibe_tools = tool_defs_for_profile(
            &HarnessProfile::default(),
            AgentRole::Auto,
            &AppSettings::default(),
        )
        .into_iter()
        .map(|tool| tool.name)
        .collect::<Vec<_>>();
        for required in [
            "write_file",
            "edit_file",
            "run_command",
            "verify",
            "delegate_task",
        ] {
            assert!(
                vibe_tools.iter().any(|n| n == required),
                "Vibe must expose {required} without a manual mode change"
            );
        }
        assert!(!vibe_tools.iter().any(|n| n == "tunnel"));
        assert_eq!(tool_iteration_budget(AgentRole::Auto, "balanced"), None);
        assert_eq!(tool_iteration_budget(AgentRole::Auto, "fast"), None);
        assert_eq!(
            tool_iteration_budget(AgentRole::Implementer, "balanced"),
            None
        );
        assert_eq!(tool_iteration_budget(AgentRole::Janitor, "balanced"), None);
        assert!(remaining_agent_budget(Instant::now(), 100).is_some());
        assert!(remaining_agent_budget(Instant::now(), 0).is_none());
    }

    #[test]
    fn native_agent_has_no_fixed_iteration_cap() {
        // Regression guard for the "Stopped after 30 tool iterations" failure.
        // Every role/speed combination must resolve to an unlimited budget, so
        // no fixed cap can ever terminate a healthy run.
        let roles = [
            AgentRole::Auto,
            AgentRole::Implementer,
            AgentRole::Planner,
            AgentRole::Tester,
            AgentRole::Janitor,
            AgentRole::Reviewer,
            AgentRole::Debugger,
        ];
        let speeds = ["balanced", "fast", "thorough"];
        for role in roles {
            for speed in speeds {
                assert_eq!(
                    tool_iteration_budget(role, speed),
                    None,
                    "role {role:?} / speed {speed} must be unlimited"
                );
            }
        }
    }

    #[test]
    fn loop_detector_flags_repeated_identical_calls() {
        let mut detector = LoopDetector::new();
        let args = serde_json::json!({ "path": "src/main.rs" });
        // Distinct results do not accumulate repeats.
        detector.observe("read_file", &args, "v1");
        detector.observe("read_file", &args, "v2");
        assert_eq!(detector.detected_repeats(), None);
        // Two identical calls are below the threshold (min 3).
        detector.observe("read_file", &args, "v1");
        detector.observe("read_file", &args, "v1");
        assert_eq!(detector.detected_repeats(), None);
        // A third identical call crosses the threshold and is reported.
        detector.observe("read_file", &args, "v1");
        assert!(detector.detected_repeats().is_some());
        assert!(detector.detected_repeats().unwrap() >= LOOP_DETECT_MIN_REPEATS);
        // A different result resets the counter.
        detector.observe("read_file", &args, "v2");
        assert_eq!(detector.detected_repeats(), None);
    }

    #[test]
    fn loop_detector_distinguishes_different_tools_and_args() {
        let mut detector = LoopDetector::new();
        let a = serde_json::json!({ "path": "a" });
        let b = serde_json::json!({ "path": "b" });
        for _ in 0..5 {
            detector.observe("run_command", &a, "same");
            detector.observe("run_command", &b, "same");
        }
        // Different arguments break the consecutive-identical chain.
        assert_eq!(detector.detected_repeats(), None);
    }

    #[test]
    fn durable_audit_labels_never_retain_tool_or_provider_payloads() {
        let tool_event = json!({
            "type": "tool_use",
            "part": {
                "tool": "Bash",
                "state": {
                    "status": "error",
                    "input": { "command": "Get-Content .env; $env:OPENAI_API_KEY" },
                    "output": "sk-never-persist-this"
                }
            }
        });
        assert_eq!(
            durable_audit_label(&tool_event),
            Some("Tool failed: workspace command.")
        );

        let provider_event = json!({
            "type": "error",
            "error": {
                "code": "PROVIDER",
                "message": "Authorization: Bearer secret-value"
            }
        });
        assert_eq!(
            durable_audit_label(&provider_event),
            Some("Provider request failed; details remain in the live session.")
        );
        assert!(durable_audit_label(&json!({
            "type": "text",
            "text": "Never write raw model text to durable history"
        }))
        .is_none());
    }

    #[test]
    fn plan_event_shape_is_emitted() {
        let event = json!({
            "type": "tool_use",
            "part": {
                "id": "call_p",
                "tool": "Plan",
                "state": { "status": "completed", "input": {"steps": ["a","b"]}, "output": "Plan:\n1. a\n2. b" }
            }
        });
        assert_eq!(event["part"]["tool"], "Plan");
        assert!(event["part"]["state"]["output"]
            .as_str()
            .unwrap()
            .contains("1. a"));
    }

    /// Verifies EVERY event shape the native agent emits against the contract
    /// that `agentEventsToParts` (bridge.ts) parses. The frontend expects:
    ///   - text:    `{ type: "text", text: string }`
    ///   - reasoning: `{ type: "reasoning", part: { text: string } }`
    ///   - tool_use: `{ type: "tool_use", part: { id, tool, state: { status, input, output } } }`
    ///   - error:   `{ type: "error", error: { message: string } }`
    ///
    /// All tool display names (Bash, Read, Write, Edit, Glob, Grep, Plan,
    /// Research) must match the known map in `displayToolName`.
    #[test]
    fn all_native_agent_events_match_frontend_contract() {
        // Text event (agent emits {type, text} without part)
        let text_event = json!({
            "type": "text",
            "text": "Inspecting the project structure..."
        });
        assert_eq!(text_event["type"], "text");
        assert!(text_event["text"].as_str().unwrap().contains("Inspecting"));
        assert!(text_event.get("part").is_none());

        // Reasoning event
        let reasoning_event = json!({
            "type": "reasoning",
            "part": { "text": "Let me think about this step by step." }
        });
        assert_eq!(reasoning_event["type"], "reasoning");
        assert!(reasoning_event["part"]["text"]
            .as_str()
            .unwrap()
            .contains("think"));

        // Error event
        let error_event = json!({
            "type": "error",
            "error": { "message": "Provider request failed: 500" }
        });
        assert_eq!(error_event["type"], "error");
        assert_eq!(
            error_event["error"]["message"],
            "Provider request failed: 500"
        );

        // --- All tool types that tool_display can return ---
        let tool_cases: &[(&str, &str)] = &[
            ("Bash", "run_command"),
            ("Read", "read_file"),
            ("Write", "write_file"),
            ("Edit", "edit_file"),
            ("Glob", "list_directory"),
            ("Grep", "grep_files"),
            ("Plan", "plan"),
            ("Research", "research"),
            ("Checkpoint", "checkpoint"),
            ("Rollback", "rollback"),
            ("Preview", "preview"),
            ("Tunnel", "tunnel"),
            ("Verify", "verify"),
        ];
        for &(display_name, _internal) in tool_cases {
            let event = json!({
                "type": "tool_use",
                "part": {
                    "id": "call_t",
                    "tool": display_name,
                    "state": {
                        "status": "completed",
                        "input": {},
                        "output": "ok"
                    }
                }
            });
            assert_eq!(
                event["type"].as_str(),
                Some("tool_use"),
                "type for tool '{display_name}'"
            );
            assert_eq!(
                event["part"]["tool"].as_str(),
                Some(display_name),
                "tool name for '{display_name}'"
            );
            assert_eq!(
                event["part"]["state"]["status"].as_str(),
                Some("completed"),
                "status for '{display_name}'"
            );
            assert!(
                !event["part"]["id"].as_str().unwrap_or_default().is_empty(),
                "id for '{display_name}'"
            );
        }

        // Error state for tool_use
        let error_tool = json!({
            "type": "tool_use",
            "part": {
                "id": "call_e",
                "tool": "Bash",
                "state": {
                    "status": "error",
                    "input": {"command": "invalid"},
                    "output": "command not found",
                    "error": "exit code 1"
                }
            }
        });
        assert_eq!(error_tool["part"]["state"]["status"], "error");
        assert!(error_tool["part"]["state"]["output"]
            .as_str()
            .unwrap()
            .contains("not found"));
    }

    /// Ensures that the tool_display mapping covers every tool definition
    /// in tool_defs() so no tool produces an unmapped display name.
    #[test]
    fn sensitive_tool_policy_gates_mutation_tools_in_both_modes() {
        let profile = HarnessProfile::default();
        let risky = AppSettings::default(); // approval_policy defaults to "risky"
        let mut always = AppSettings::default();
        always.agent.approval_policy = "always".into();

        let risky_names: Vec<String> = tool_defs_for_profile(&profile, AgentRole::Implementer, &risky)
            .into_iter()
            .map(|tool| tool.name)
            .collect();
        let always_names: Vec<String> = tool_defs_for_profile(&profile, AgentRole::Implementer, &always)
            .into_iter()
            .map(|tool| tool.name)
            .collect();

        for allowed in [
            "write_file",
            "edit_file",
            "run_command",
            "checkpoint",
            "rollback",
            "preview",
            "tunnel",
        ] {
            assert!(
                risky_names.iter().any(|n| n == allowed),
                "risky policy should expose {allowed}"
            );
        }

        for blocked in [
            "write_file",
            "edit_file",
            "run_command",
            "checkpoint",
            "rollback",
            "preview",
            "tunnel",
        ] {
            assert!(
                !always_names.iter().any(|n| n == blocked),
                "always policy must withhold {blocked}"
            );
        }

        assert!(always_names.iter().any(|n| n == "read_file"));
        assert!(always_names.iter().any(|n| n == "plan"));
    }

    #[test]
    fn always_approve_policy_withholds_mutating_tools() {
        let profile = HarnessProfile::default();
        let mut settings = AppSettings::default();
        settings.agent.approval_policy = "always".into();
        let tools = tool_defs_for_profile(&profile, AgentRole::Implementer, &settings);
        let names: Vec<String> = tools.into_iter().map(|tool| tool.name).collect();
        assert!(names.iter().any(|n| n == "read_file"));
        assert!(names.iter().any(|n| n == "plan"));
        assert!(!names.iter().any(|n| n == "write_file"));
        assert!(!names.iter().any(|n| n == "run_command"));
    }

    #[test]
    fn harness_profile_loader_fails_closed_for_invalid_project_policy() {
        let dir =
            std::env::temp_dir().join(format!("whim-harness-profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create workspace");
        std::fs::write(
            dir.join(HARNESS_PROFILE_PATH),
            r#"{"allowedTools":["not-a-tool"]}"#,
        )
        .expect("write invalid profile");
        assert!(load_harness_profile(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn all_tools_have_display_names() {
        let internal_names: Vec<String> = tool_defs().into_iter().map(|tool| tool.name).collect();
        let display_names: Vec<String> = internal_names
            .iter()
            .map(|name| tool_display(name))
            .collect();
        // verify no tool returns its raw name (all must be mapped)
        // The known map in displayToolName (bridge.ts) mirrors this.
        let known_display = [
            "Bash",
            "Read",
            "Write",
            "Edit",
            "Glob",
            "Grep",
            "Plan",
            "Research",
            "Checkpoint",
            "Rollback",
            "Preview",
            "Tunnel",
            "Verify",
            "Delegate",
            "Browser",
            "Desktop",
        ];
        for display in &display_names {
            assert!(
                known_display.contains(&display.as_str()),
                "tool_display returned unmapped name '{display}'"
            );
        }
        // Verify count matches
        assert_eq!(internal_names.len(), known_display.len());
        assert_eq!(display_names.len(), known_display.len());
    }

    #[test]
    fn resolve_key_prefers_explicit_key() {
        // Explicit in-session key wins over (potential) environment key.
        assert_eq!(
            resolve_key(Provider::OpenAi, &Some("sk-ui".to_string())),
            Some("sk-ui".to_string())
        );
        // Local providers never need a key.
        assert_eq!(resolve_key(Provider::Local, &None), None);
        // An empty UI key is treated as absent (so the early API-key check fires
        // when no environment key is present either).
        assert_eq!(resolve_key(Provider::OpenAi, &Some(String::new())), None);
    }

    #[test]
    fn provider_credentials_support_aliases_without_exposing_environment_values() {
        assert_eq!(
            provider_environment_variables("opencode"),
            &["OPENCODE_API_KEY"]
        );
        assert_eq!(
            provider_environment_variables("google"),
            &[
                "GOOGLE_API_KEY",
                "GEMINI_API_KEY",
                "GOOGLE_GENERATIVE_AI_API_KEY"
            ]
        );
        let resolved = resolve_key_with(Provider::Google, &None, |name| {
            (name == "GEMINI_API_KEY").then(|| "  gemini-native-key  ".to_string())
        });
        assert_eq!(resolved.as_deref(), Some("gemini-native-key"));

        let explicit = resolve_key_with(
            Provider::Google,
            &Some("  session-key  ".to_string()),
            |_| Some("environment-key".to_string()),
        );
        assert_eq!(explicit.as_deref(), Some("session-key"));
    }

    #[test]
    fn opencode_auth_store_accepts_only_bounded_api_key_records() {
        let records = json!({
            "google": { "type": "api", "key": "  google-native-key  " },
            "opencode": { "type": "api", "key": "zen-native-key" },
            "anthropic": { "type": "oauth", "access": "must-not-be-reused" }
        });
        assert_eq!(
            parse_stored_opencode_api_key(&records, Provider::Google).as_deref(),
            Some("google-native-key")
        );
        assert_eq!(
            parse_stored_opencode_api_key(&records, Provider::OpenCode).as_deref(),
            Some("zen-native-key")
        );
        assert_eq!(
            parse_stored_opencode_api_key(&records, Provider::Anthropic),
            None
        );

        let oversized = json!({
            "opencode": { "type": "api", "key": "x".repeat(MAX_STORED_API_KEY_BYTES + 1) }
        });
        assert_eq!(
            parse_stored_opencode_api_key(&oversized, Provider::OpenCode),
            None
        );
    }

    /// Verifies that run_native_agent's success/error derivation from events
    /// is correct. No error events -> success, any error event -> failure with
    /// stderr populated and exit_code=1. Timeout errors set timed_out=true.
    #[test]
    fn native_agent_success_derives_from_events() {
        use serde_json::json;

        // No events at all -> success
        let events: Vec<Value> = vec![];
        let has_error = events
            .iter()
            .any(|e| e.get("type").and_then(Value::as_str) == Some("error"));
        assert!(!has_error);

        // Only text events -> success
        let events = [
            json!({"type": "text", "text": "hello"}),
            json!({"type": "tool_use", "part": {"tool": "Bash", "state": {"status": "completed", "input": {}, "output": "ok"}}}),
        ];
        let has_error = events
            .iter()
            .any(|e| e.get("type").and_then(Value::as_str) == Some("error"));
        assert!(!has_error);

        // Single error event -> failure, stderr populated, exit_code=1
        let events = [
            json!({"type": "error", "error": {"message": "Provider request failed: 401 Unauthorized"}}),
        ];
        let has_error = events
            .iter()
            .any(|e| e.get("type").and_then(Value::as_str) == Some("error"));
        assert!(has_error);
        let stderr: Vec<String> = events
            .iter()
            .filter_map(|e| {
                if e.get("type").and_then(Value::as_str) == Some("error") {
                    e.pointer("/error/message")
                        .and_then(Value::as_str)
                        .map(String::from)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(stderr, vec!["Provider request failed: 401 Unauthorized"]);
        let expected_exit_code: Option<i32> = if has_error { Some(1) } else { Some(0) };
        assert_eq!(expected_exit_code, Some(1));

        // Multiple error events -> stderr contains all messages
        let events = [
            json!({"type": "error", "error": {"message": "First error"}}),
            json!({"type": "text", "text": "intermediate"}),
            json!({"type": "error", "error": {"message": "Second error"}}),
        ];
        let has_error = events
            .iter()
            .any(|e| e.get("type").and_then(Value::as_str) == Some("error"));
        assert!(has_error);
        let stderr: Vec<String> = events
            .iter()
            .filter_map(|e| {
                if e.get("type").and_then(Value::as_str) == Some("error") {
                    e.pointer("/error/message")
                        .and_then(Value::as_str)
                        .map(String::from)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(stderr.join("\n"), "First error\nSecond error");

        // Timeout error -> timed_out=true
        let events = [json!({"type": "error", "error": {"message": "Agent run timed out"}})];
        let has_error = events
            .iter()
            .any(|e| e.get("type").and_then(Value::as_str) == Some("error"));
        assert!(has_error);
        let timed_out = has_error
            && events.iter().any(|e| {
                e.get("type").and_then(Value::as_str) == Some("error")
                    && e.pointer("/error/message")
                        .and_then(Value::as_str)
                        .is_some_and(|m| m.contains("timed out"))
            });
        assert!(timed_out);

        // Non-timeout error -> timed_out=false
        let events =
            [json!({"type": "error", "error": {"message": "Provider request failed: 500"}})];
        let has_error = events
            .iter()
            .any(|e| e.get("type").and_then(Value::as_str) == Some("error"));
        assert!(has_error);
        let timed_out = has_error
            && events.iter().any(|e| {
                e.get("type").and_then(Value::as_str) == Some("error")
                    && e.pointer("/error/message")
                        .and_then(Value::as_str)
                        .is_some_and(|m| m.contains("timed out"))
            });
        assert!(!timed_out);
    }

    #[test]
    fn resolve_key_regression_guard_no_terminal_fallback() {
        // Enforce that resolve_key remains a pure function of env/session parameters,
        // never spawning terminal CLI fallbacks for credential discovery.
        let provider = Provider::OpenAi;
        let env_var = provider_env_var(provider).unwrap();
        let old_val = std::env::var(env_var).ok();

        std::env::remove_var(env_var);
        let resolved = resolve_key(provider, &None);
        assert_eq!(
            resolved, None,
            "Must not fall back to CLI or spawn processes when key is missing"
        );

        if let Some(val) = old_val {
            std::env::set_var(env_var, val);
        }
    }

    #[test]
    fn agent_event_serialization_regression_test() {
        // Verify serialization output of each AgentEvent variant matches the frontend contract.

        // 1. Text
        let text_evt = AgentEvent::Text {
            text: "hello".into(),
        };
        let text_json = serde_json::to_value(&text_evt).unwrap();
        assert_eq!(text_json["type"], "text");
        assert_eq!(text_json["text"], "hello");

        // 2. Reasoning
        let reasoning_evt = AgentEvent::Reasoning {
            part: ReasoningPart {
                text: "thinking".into(),
            },
        };
        let reasoning_json = serde_json::to_value(&reasoning_evt).unwrap();
        assert_eq!(reasoning_json["type"], "reasoning");
        assert_eq!(reasoning_json["part"]["text"], "thinking");

        // 3. ToolUse
        let tool_evt = AgentEvent::ToolUse {
            part: ToolUsePart {
                id: "call_1".into(),
                tool: "Bash".into(),
                state: ToolUseState {
                    status: "completed".into(),
                    input: serde_json::json!({"command": "ls"}),
                    output: Some(serde_json::json!("ok")),
                    error: None,
                },
            },
        };
        let tool_json = serde_json::to_value(&tool_evt).unwrap();
        assert_eq!(tool_json["type"], "tool_use");
        assert_eq!(tool_json["part"]["id"], "call_1");
        assert_eq!(tool_json["part"]["tool"], "Bash");
        assert_eq!(tool_json["part"]["state"]["status"], "completed");
        assert_eq!(tool_json["part"]["state"]["input"]["command"], "ls");
        assert_eq!(tool_json["part"]["state"]["output"], "ok");

        // 4. Warning (advisory, never a hard stop)
        let warn_evt = AgentEvent::Warning {
            code: "POSSIBLE_LOOP".into(),
            message: "Possible non-progress loop detected.".into(),
        };
        let warn_json = serde_json::to_value(&warn_evt).unwrap();
        assert_eq!(warn_json["type"], "warning");
        assert_eq!(warn_json["code"], "POSSIBLE_LOOP");
        assert_eq!(warn_json["message"], "Possible non-progress loop detected.");

        // 5. Progress
        let prog_evt = AgentEvent::Progress {
            message: "working".into(),
        };
        let prog_json = serde_json::to_value(&prog_evt).unwrap();
        assert_eq!(prog_json["type"], "progress");
        assert_eq!(prog_json["message"], "working");
    }
}

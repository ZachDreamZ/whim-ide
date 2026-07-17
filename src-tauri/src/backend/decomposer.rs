//! Intent decomposer — calls the cheapest available model to split a
//! user intent into parallel sub-tasks with explicit dependencies.

use crate::agent::{self, default_model, parse_provider, AgentRole, Provider};
use crate::orchestrator::SubTask;
use serde_json::Value;
use std::collections::HashSet;

const DECOMPOSE_SYSTEM: &str = r#"You are a task decomposition engine. Your job is to break a user's intent into independent parallel sub-tasks. Each sub-task should be self-contained and have clear dependencies.

Respond ONLY with a JSON array. No markdown, no explanation, no code fences.

Each element:
{
  "id": "task-a",
  "description": "Specific, actionable description of this sub-task.",
  "deps": []  // array of task IDs this depends on. Empty = no deps = parallel-ready.
}

Rules:
- Tasks with empty deps array run in parallel.
- Tasks with deps wait for those tasks to complete first.
- Keep sub-tasks coarse enough to be meaningful agent work (5-30 min each).
- Max 8 sub-tasks. For simple intents, produce 1-3.
- IDs: single letter suffix like "task-a", "task-b""#;

const MAX_SUB_TASKS: usize = 8;

/// Decompose an intent into sub-tasks using the cheapest available model.
/// Falls back to a single "do it all" sub-task if decomposition fails.
pub async fn decompose_intent(
    intent: &str,
    provider: Option<&str>,
    model: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> Result<Vec<SubTask>, String> {
    if intent.trim().is_empty() {
        return Err("Intent must not be empty".to_string());
    }

    // Pick the cheapest model for decomposition. If no provider specified,
    // use what's available. Prefer cheap/fast models.
    let (decomp_provider, decomp_model, decomp_key, decomp_base) = resolve_decomposition_model(
        provider, model, api_key, base_url,
    );

    // Build a minimal prompt
    let prompt = format!(
        "{}\n\nIntent to decompose:\n{}",
        DECOMPOSE_SYSTEM, intent
    );

    // Call the model
    let messages = vec![
        serde_json::json!({"role": "user", "content": prompt}),
    ];
    let raw = agent::run_model_chat(
        &decomp_provider,
        &decomp_model,
        &decomp_key.unwrap_or_default(),
        &decomp_base,
        DECOMPOSE_SYSTEM,
        &messages,
    )
    .await?;
    // Try to extract JSON array from the response (handle code fences)
    let json_str = if raw.starts_with('[') {
        raw.to_string()
    } else if let Some(start) = raw.find('[') {
        if let Some(end) = raw.rfind(']') {
            raw[start..=end].to_string()
        } else {
            return fallback_single_task(intent);
        }
    } else {
        return fallback_single_task(intent);
    };

    match serde_json::from_str::<Vec<Value>>(&json_str) {
        Ok(items) => {
            if items.is_empty() || items.len() > MAX_SUB_TASKS {
                return fallback_single_task(intent);
            }
            let mut tasks = Vec::new();
            let mut ids = HashSet::new();
            for item in &items {
                let id = item
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if id.is_empty() || !ids.insert(id.clone()) {
                    continue;
                }
                let description = item
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if description.is_empty() {
                    continue;
                }
                let deps = item
                    .get("deps")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|d| d.as_str().map(String::from))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                tasks.push(SubTask {
                    id,
                    parent_job_id: String::new(), // filled by caller
                    description,
                    deps,
                    provider: None,
                    model: None,
                    status: crate::orchestrator::SubTaskStatus::Pending,
                    attempt: 0,
                    max_attempts: 2,
                    summary: None,
                    error: None,
                    started_at_ms: None,
                    finished_at_ms: None,
                });
            }
            if tasks.is_empty() {
                return fallback_single_task(intent);
            }
            Ok(tasks)
        }
        Err(_) => fallback_single_task(intent),
    }
}

/// Fallback: one monolithic task.
fn fallback_single_task(intent: &str) -> Result<Vec<SubTask>, String> {
    Ok(vec![SubTask {
        id: "task-main".to_string(),
        parent_job_id: String::new(),
        description: intent.to_string(),
        deps: vec![],
        provider: None,
        model: None,
        status: crate::orchestrator::SubTaskStatus::Ready,
        attempt: 0,
        max_attempts: 3,
        summary: None,
        error: None,
        started_at_ms: None,
        finished_at_ms: None,
    }])
}

/// Resolve the cheapest model for decomposition.
fn resolve_decomposition_model(
    provider: Option<&str>,
    model: Option<&str>,
    api_key: Option<&str>,
    base_url: Option<&str>,
) -> (String, String, Option<String>, String) {
    // If user specified a provider, use it but try to pick a cheap model
    if let Some(p) = provider {
        if !p.is_empty() && !p.eq_ignore_ascii_case("auto") {
            let parsed = parse_provider(p).unwrap_or(Provider::Local);
            let cheap_model = match parsed {
                Provider::OpenAi => "gpt-4o-mini",
                Provider::Anthropic => "claude-3-5-haiku-latest",
                Provider::Google => "gemini-2.5-flash",
                Provider::ZenMux | Provider::OpenCode | Provider::DeepSeek => model.unwrap_or("auto"),
                _ => model.unwrap_or(""),
            }
            .to_string();
            return (p.to_string(), cheap_model, api_key.map(String::from), base_url.unwrap_or("").to_string());
        }
    }

    // Auto: try OpenCode Zen (local cheap), then qwen, then openai
    for (prov, modl, base) in &[
        ("opencode", "", ""),
        ("local", "", ""),
        ("qwen", "qwen3-turbo", ""),
        ("openai", "gpt-4o-mini", ""),
    ] {
        let key = agent::provider_key_available(prov);
        if key || *prov == "local" {
            return (
                prov.to_string(),
                if modl.is_empty() {
                    default_model(parse_provider(prov).unwrap_or(Provider::Local), AgentRole::Researcher).to_string()
                } else {
                    modl.to_string()
                },
                None,
                base.to_string(),
            );
        }
    }

    // Last resort: whatever provider says auto
    (
        "auto".to_string(),
        model.unwrap_or("").to_string(),
        api_key.map(String::from),
        base_url.unwrap_or("").to_string(),
    )
}

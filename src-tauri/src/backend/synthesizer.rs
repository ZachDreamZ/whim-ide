//! Synthesizer — merges sub-task results into a coherent final summary.
//!
//! Called after all sub-tasks of a multi-agent run complete. Collects
//! each sub-task's summary/evidence and calls a cheap model to produce
//! a one-paragraph synthesized result. Falls back to concatenation if
//! the model call fails.

use crate::agent::{self, default_model, parse_provider, AgentRole, Provider};
use crate::orchestrator::SubTask;
use serde_json::json;

const SYNTHESIZE_SYSTEM: &str = r#"You are a task-output synthesizer. Given a user's original intent and the results from several sub-tasks that were run in parallel, produce a concise, coherent summary of what was accomplished.

Rules:
- Focus on outcomes, not process steps.
- Mention the most important findings or deliverables.
- Keep the summary to 1-3 paragraphs.
- If a sub-task failed, note the failure briefly.
- Do not list every sub-task name — only the synthesized results.
- Plain text response. No markdown, no JSON, no code fences."#;

/// Synthesize sub-task results into a coherent summary.
///
/// Calls a cheap model if available; falls back to simple concatenation.
pub async fn synthesize(
    intent: &str,
    sub_tasks: &[SubTask],
) -> Result<String, String> {
    if sub_tasks.is_empty() {
        return Ok("No sub-tasks were executed.".to_string());
    }

    // Build a structured result summary
    let mut results_text = String::new();
    for st in sub_tasks {
        let status = match st.status {
            crate::orchestrator::SubTaskStatus::Completed => "✅ Completed",
            crate::orchestrator::SubTaskStatus::Failed => "❌ Failed",
            crate::orchestrator::SubTaskStatus::Skipped => "⏭ Skipped",
            _ => "⚪ Unknown",
        };
        results_text.push_str(&format!(
            "{} [{}] {}: {}\n",
            status,
            st.provider.as_deref().unwrap_or("auto"),
            st.id,
            st.error.as_deref().unwrap_or(&st.description),
        ));
        if let Some(ref summary) = st.summary {
            results_text.push_str(&format!("  → {}\n", summary));
        }
    }

    // Try a model call for synthesis
    let prompt = format!(
        "Original intent:\n{}\n\nSub-task results:\n{}",
        intent, results_text
    );

    let messages = vec![json!({"role": "user", "content": prompt})];

    // Try providers in order of cheapness
    let candidates: &[(&str, &str)] = &[
        ("opencode", ""),
        ("local", ""),
        ("deepseek", ""),
        ("zenmux", ""),
        ("openai", "gpt-4o-mini"),
    ];

    for (prov, forced_model) in candidates {
        if prov == &"local" {
            continue; // synthesizer needs a real model, skip local-only
        }
        if !agent::provider_key_available(prov) {
            continue;
        }
        let model = if forced_model.is_empty() {
            default_model(
                parse_provider(prov).unwrap_or(Provider::OpenAi),
                AgentRole::Researcher,
            )
            .to_string()
        } else {
            forced_model.to_string()
        };

        match agent::run_model_chat(
            prov, &model, "", "",
            SYNTHESIZE_SYSTEM, &messages,
        )
        .await
        {
            Ok(text) => {
                let trimmed = text.trim().to_string();
                if !trimmed.is_empty() {
                    return Ok(trimmed);
                }
            }
            Err(_) => continue,
        }
    }

    // Fallback: simple concatenation
    Ok(results_text)
}

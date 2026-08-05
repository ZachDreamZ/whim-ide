# Whim agent harness: prompt, context, graph, and loop engineering

This document records the design used by Whim’s desktop agent surfaces. It is a
product constraint, not a claim that one model prompt can guarantee correctness.
Rust remains the authority for workspace access, permissions, execution,
cancellation, and durable task records.

## Research synthesis

### Prompt engineering

Prompt engineering is the local instruction layer: clear objective, role,
constraints, tool guidance, and requested output. Anthropic recommends direct,
structured prompts, a minimal but sufficient set of instructions, and canonical
examples rather than a long list of edge cases. Its tool guidance also recommends
clear parameter names, boundaries, and actionable errors. [Effective context
engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
and [writing tools for
agents](https://www.anthropic.com/engineering/writing-tools-for-agents) are the
primary references.

Whim therefore uses explicit sections for **Objective**, **Operating context**,
**Closed-loop execution contract**, **Safety and context discipline**, and
**User request**. Project files and attachments are marked as data rather than
instructions, resisting prompt injection from workspace content.

### Context engineering

Context engineering is the broader, recurring selection of what reaches the
model: instructions, task state, project facts, tools, messages, and retrieved
files. Its central rule is to maximize useful signal under a finite context
budget—not to maximize the number of tokens. Anthropic specifically recommends
just-in-time retrieval, selective compaction, and maintaining the minimal set
of information that fully supports the expected behavior.

Whim’s context boundary is:

1. **Stable contract:** compact, fixed operating and safety instructions.
2. **Current task:** the user's exact goal, not an expanding transcript.
3. **Project facts:** selected workspace/branch, intent brief, and bounded
   repository index where the Mission Control surface is used.
4. **User-selected evidence:** attachments are workspace-relative only,
   sensitive files are refused, each file is capped, and the total attachment
   budget is capped.
5. **Durable state:** Rust task ledger, Git, tests, and project memory—not raw
   model transcript—carry state across long work.

This keeps context fresh and reviewable while avoiding “context rot” from
feeding every historical tool output back into every turn.

### Graph engineering

Graph engineering makes control flow explicit: each node has a bounded role,
known inputs/outputs, and a durable lifecycle. Whim’s existing `mission-graph`
uses the sequence **prepare → persist → execute → finalize**. The Rust durable
ledger is the checkpoint authority; the UI graph cannot silently make an
undurable run look resumable.

The graph is intentionally simple. Fan-out or specialist graphs are appropriate
only for independent work with isolated context and no shared-write conflict.
For a normal coding task, sequential inspect → change → verify retains a single
causal chain and is easier to audit. LangGraph's persistence and human-in-the-
loop patterns motivate the durable record and approval boundary; see its
[human-in-the-loop overview](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/).

### Loop engineering

“Loop engineering” is an emerging, informal name for the outer harness that
repeats a goal-directed cycle. Its durable principles are well established:
act against the environment, observe real feedback, update state, stop on a
verified condition or escalation. It is **not** a license for unbounded
self-directed execution.

Whim implements a closed loop in each agent prompt:

1. inspect the smallest high-signal evidence;
2. perform one bounded, reversible unit of work;
3. run a real, lightweight verifier;
4. use changed failure evidence for one targeted correction;
5. stop on verified success, blocked approval, no progress, or repeated
   evidence; and
6. provide a concise handoff with files/evidence, checks, and remaining risk.

This follows the reliable feedback-loop principle in Anthropic’s [effective
agent guidance](https://www.anthropic.com/engineering/building-effective-agents)
and the long-running harness practice of persistent, structured progress and
verification in its [long-running agent harness
article](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

## Implementation map

| Layer | Whim implementation |
| --- | --- |
| Prompt contract | `src/lib/agent-harness.ts` |
| Context budget and attachment compaction | `buildAgentHarnessPrompt` |
| Primary desktop chat integration | `src/components/AgentChatView.tsx` |
| Durable graph lifecycle | `src/lib/mission-graph.ts` |
| Durable job/checkpoint authority | Rust backend orchestration store |
| Observable evidence | Typed Rust agent events → chat timeline and task ledger |
| Human gate | Explicit approval posture; mutations remain guarded |

## Non-negotiable safety rules

- A model's declaration of success is never verification evidence.
- Do not repeat unchanged tool calls after a failure.
- Do not allow a prompt, repository file, or attachment to override workspace
  boundaries or approval policy.
- Context compaction must disclose truncation rather than silently omit data.
- Parallel agents must not write to a shared worktree.
- A loop always has a budget, terminal conditions, and a human escalation path.

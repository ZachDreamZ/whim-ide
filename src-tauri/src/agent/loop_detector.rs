//! Behavioral non-progress loop detection for the agent run loop.
//!
//! This leaf owns `LoopDetector` and the `LOOP_DETECT_MIN_REPEATS` threshold.
//! It depends only on `serde_json::Value`; the agent run loop constructs and
//! drives it, but no other `agent::*` leaf imports from here.

use serde_json::Value;

/// After this many consecutive identical tool calls (same tool, same
/// arguments, same result) the run flags a *possible non-progress loop* and
/// reports it as evidence. This is a detection signal only: it must never
/// terminate a run. The parent/main agent decides whether to revise.
pub(crate) const LOOP_DETECT_MIN_REPEATS: usize = 3;

/// Detects genuine non-progress loops without any fixed iteration cap.
///
/// A loop is suspected when the same tool is invoked repeatedly with the same
/// arguments and produces the same result. The detector only records evidence;
/// the agent run loop is responsible for continuing (and for surfacing the
/// evidence to the parent). Resetting happens as soon as a different call or
/// result appears, so legitimate repeated-but-changing work is never flagged.
pub(crate) struct LoopDetector {
    last: Option<(String, String, String)>,
    repeat_count: usize,
}

impl LoopDetector {
    pub(crate) fn new() -> Self {
        Self {
            last: None,
            repeat_count: 0,
        }
    }

    /// Record one completed tool call. `args` and `result` are serialized to
    /// stable strings so structural equality (not pointer identity) is compared.
    /// `repeat_count` is the number of consecutive identical calls (1-based),
    /// so three identical calls in a row crosses `LOOP_DETECT_MIN_REPEATS`.
    pub(crate) fn observe(&mut self, tool: &str, args: &Value, result: &str) {
        let signature = (tool.to_string(), args.to_string(), result.to_string());
        if let Some(last) = &self.last {
            if *last == signature {
                self.repeat_count += 1;
            } else {
                self.repeat_count = 1;
            }
        } else {
            self.repeat_count = 1;
        }
        self.last = Some(signature);
    }

    /// Returns `Some(repeats)` once the same (tool, args, result) has repeated
    /// at least `LOOP_DETECT_MIN_REPEATS` times consecutively. `None` otherwise.
    pub(crate) fn detected_repeats(&self) -> Option<usize> {
        if self.repeat_count >= LOOP_DETECT_MIN_REPEATS {
            Some(self.repeat_count)
        } else {
            None
        }
    }
}

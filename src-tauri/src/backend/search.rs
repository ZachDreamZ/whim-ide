//! Workspace search — full-text search across workspace files.
//!
//! Uses the `ignore` crate (already a dependency) for gitignore-aware
//! file walking and `regex` for pattern matching. Returns results
//! grouped by file with line numbers and context snippets.

use regex::Regex;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

/// A single match result.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// Absolute file path.
    pub path: String,
    /// 1-indexed line number.
    pub line: u32,
    /// Column offset of the match (0-indexed byte offset).
    pub column: u32,
    /// The full line text.
    pub line_text: String,
    /// Lines before the match (up to `context_lines`).
    pub context_before: Vec<String>,
    /// Lines after the match (up to `context_lines`).
    pub context_after: Vec<String>,
}

/// Options for workspace search.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    /// If true, treat query as a regex. Otherwise literal substring.
    pub use_regex: bool,
    /// If true, case-sensitive matching.
    pub case_sensitive: bool,
    /// Number of context lines before/after each match (default 0).
    pub context_lines: u32,
    /// Max total results (default 200, max 1000).
    pub max_results: u32,
    /// Optional glob pattern to include only matching file paths.
    pub include_glob: Option<String>,
    /// Optional pattern to exclude files by path.
    pub exclude_glob: Option<String>,
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            use_regex: false,
            case_sensitive: false,
            context_lines: 0,
            max_results: 200,
            include_glob: None,
            exclude_glob: None,
        }
    }
}

/// Search workspace files for the given query.
#[tauri::command]
pub fn search_workspace(
    path: String,
    query: String,
    options: Option<SearchOptions>,
) -> Result<Vec<SearchMatch>, String> {
    let opts = options.unwrap_or_default();
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let query_len = query.len();
    if query.is_empty() {
        return Err("Query cannot be empty".into());
    }

    // Compile the regex
    let pattern: Regex = if opts.use_regex {
        Regex::new(&query).map_err(|e| format!("Invalid regex: {e}"))?
    } else {
        let escaped = regex::escape(&query);
        let pattern_str = if opts.case_sensitive {
            format!("({escaped})")
        } else {
            format!("(?i)({escaped})")
        };
        Regex::new(&pattern_str).map_err(|e| format!("Regex error: {e}"))?
    };

    // If case-sensitive was requested for literal mode, we don't add (?i)
    // But the regex above handles it: when case_sensitive=true, we use literal without (?i)
    // Actually for use_regex=false and case_sensitive=true, we just escape the query
    // For use_regex=false and case_sensitive=false, we add (?i)
    // Let me rebuild the pattern to handle this correctly.

    let pattern: Regex = if opts.use_regex {
        let p = if opts.case_sensitive {
            query.clone()
        } else {
            format!("(?i){query}")
        };
        Regex::new(&p).map_err(|e| format!("Invalid regex: {e}"))?
    } else {
        let escaped = regex::escape(&query);
        if opts.case_sensitive {
            Regex::new(&format!("({escaped})"))
        } else {
            Regex::new(&format!("(?i)({escaped})"))
        }
        .map_err(|e| format!("Regex error: {e}"))?
    };

    // Walk files respecting .gitignore
    let max_results = opts.max_results.clamp(1, 1000) as usize;
    let ctx_lines = opts.context_lines as usize;

    let (tx, rx) = mpsc::channel::<SearchMatch>();

    let walker = ignore::WalkBuilder::new(&root)
        .standard_filters(true) // Respect .gitignore, hidden files, etc.
        .build();

    let root_clone = root.clone();
    thread::Builder::new()
        .name("whim-search".into())
        .spawn(move || {
            let deadline = Duration::from_secs(30);
            let start = Instant::now();

            for entry in walker {
                if start.elapsed() > deadline {
                    break; // Timeout after 30 seconds
                }

                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                let file_path = entry.path();
                if !file_path.is_file() {
                    continue;
                }

                // Skip binary files by extension
                let ext = file_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();

                // Known text extensions
                let text_extensions = [
                    "ts", "tsx", "js", "jsx", "mjs", "cjs",
                    "rs", "toml", "json", "yaml", "yml", "md", "mdx",
                    "css", "scss", "less", "html", "htm", "xml",
                    "sh", "bash", "zsh", "ps1", "bat", "cmd",
                    "py", "rb", "go", "java", "kt", "swift",
                    "c", "h", "cpp", "hpp", "cc", "hh",
                    "svelte", "vue", "astro",
                    "txt", "env", "gitignore", "editorconfig",
                    "sql", "graphql", "prisma",
                ];

                if !text_extensions.contains(&ext.as_str()) {
                    // Try to detect text by reading first few bytes
                    let is_text = is_probably_text_file(file_path);
                    if !is_text {
                        continue;
                    }
                }

                // Glob filters
                if let Some(ref include) = opts.include_glob {
                    let matched = glob_match(include, file_path, &root_clone);
                    if !matched {
                        continue;
                    }
                }
                if let Some(ref exclude) = opts.exclude_glob {
                    let matched = glob_match(exclude, file_path, &root_clone);
                    if matched {
                        continue;
                    }
                }

                // Read and search file
                let content = match fs::read_to_string(file_path) {
                    Ok(c) => c,
                    Err(_) => continue, // Binary or unreadable
                };

                let rel_path = file_path
                    .strip_prefix(&root_clone)
                    .unwrap_or(file_path)
                    .to_string_lossy()
                    .into_owned();

                let lines: Vec<&str> = content.lines().collect();

                for (line_idx, line) in lines.iter().enumerate() {
                    if let Some(mat) = pattern.find(line) {
                        let line_num = (line_idx + 1) as u32;
                        let col = mat.start() as u32;

                        // Context lines
                        let before: Vec<String> = lines
                            .iter()
                            .skip(line_idx.saturating_sub(ctx_lines))
                            .take(ctx_lines.min(line_idx))
                            .map(|s| s.to_string())
                            .collect();

                        let after_start = line_idx + 1;
                        let after: Vec<String> = lines
                            .iter()
                            .skip(after_start)
                            .take(ctx_lines)
                            .map(|s| s.to_string())
                            .collect();

                        let result = SearchMatch {
                            path: rel_path.clone(),
                            line: line_num,
                            column: col,
                            line_text: (*line).to_string(),
                            context_before: before,
                            context_after: after,
                        };

                        if tx.send(result).is_err() {
                            return;
                        }
                    }
                }
            }
        })
        .map_err(|e| format!("Failed to spawn search thread: {e}"))?;

    // Collect results from channel with timeout
    let mut results: Vec<SearchMatch> = Vec::new();
    let deadline = Duration::from_secs(35); // Slightly longer than thread timeout
    let poll_start = Instant::now();

    while poll_start.elapsed() < deadline && results.len() < max_results {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(m) => {
                results.push(m);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Thread might still be working; continue polling
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break; // Thread finished
            }
        }
    }

    Ok(results)
}

/// Simple glob matching for include/exclude filters.
/// Supports `*` (any chars except `/`) and `**` (any chars including `/`).
fn glob_match(pattern: &str, file_path: &Path, root: &Path) -> bool {
    let rel = file_path.strip_prefix(root).unwrap_or(file_path);
    let rel_str = rel.to_string_lossy();

    // Convert glob pattern to regex
    let regex_pattern = pattern
        .replace('.', "\\.")
        .replace("**", "___DOUBLESTAR___")
        .replace('*', "[^/]*")
        .replace("___DOUBLESTAR___", ".*")
        .replace('?', "[^/]");

    let re = match Regex::new(&format!("^(?:{regex_pattern})$")) {
        Ok(r) => r,
        Err(_) => return false,
    };

    re.is_match(&rel_str)
}

/// Quick check if a file is probably text by reading its first 512 bytes.
fn is_probably_text_file(path: &Path) -> bool {
    let data = match fs::read(path) {
        Ok(d) => d,
        Err(_) => return false,
    };
    if data.is_empty() {
        return true;
    }
    // Check for null bytes (binary indicator)
    let sample = if data.len() > 512 { &data[..512] } else { &data };
    !sample.contains(&0)
}

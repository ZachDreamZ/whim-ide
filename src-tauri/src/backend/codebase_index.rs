//! Codebase index — compact structural index of a workspace.
//!
//! Walks source files (JS/TS/Rust), extracts exports, imports, symbols,
//! routes, and database ops, then produces a token-efficient MANIFEST.md
//! plus a queryable symbol index.
//!
//! The agent reads MANIFEST.md (~2KB for a 100-file project) instead of
//! scanning every source file (~200KB tokens), saving ~100x on codebase
//! understanding.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

const INDEX_VERSION: u32 = 1;
const MAX_FILE_SIZE: u64 = 512 * 1024; // skip files over 512KB
const MAX_WALK_FILES: usize = 5_000;

/// Per-file index entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndex {
    /// Relative path from workspace root
    pub file: String,
    /// Language group: "ts", "js", "rs", "css", "md", "json", "other"
    pub language: String,
    /// Exported symbols (functions, classes, consts, types, interfaces)
    pub exports: Vec<String>,
    /// Import paths (local relative/absolute, not npm)
    pub imports: Vec<String>,
    /// Local file dependencies (resolved import paths)
    pub deps: Vec<String>,
    /// Route registrations (e.g. "GET /api/users")
    pub routes: Vec<String>,
    /// Database operations (e.g. "prisma.findMany", "knex.select")
    pub db_ops: Vec<String>,
    /// Line count
    pub lines: u32,
    /// Size in bytes
    pub size: u64,
    /// Last modified timestamp (unix ms)
    pub modified_ms: u64,
}

/// The complete index for one workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseIndex {
    pub version: u32,
    pub workspace: String,
    pub workspace_name: String,
    pub generated_at_ms: u64,
    pub total_files: u32,
    pub total_lines: u32,
    /// Files grouped by directory
    pub files: Vec<FileIndex>,
    /// Reverse index: symbol → file paths
    pub symbol_index: HashMap<String, Vec<String>>,
    /// File-level dependency edges: file → [dependents]
    pub reverse_deps: HashMap<String, Vec<String>>,
}

/// Language classification
fn classify_file(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("ts" | "tsx") => "ts",
        Some("js" | "jsx" | "mjs" | "cjs") => "js",
        Some("rs") => "rs",
        Some("css" | "scss" | "less") => "css",
        Some("md" | "mdx") => "md",
        Some("json") => "json",
        Some("yaml" | "yml") => "yaml",
        Some("toml") => "toml",
        _ => "other",
    }
}

/// Lightweight regex-free line scanner for a source file.
/// Returns (exports, imports, routes, db_ops, local_deps).
fn scan_source_file(path: &Path, content: &str) -> (Vec<String>, Vec<String>, Vec<String>, Vec<String>, Vec<String>) {
    let language = classify_file(path);
    let mut exports: Vec<String> = Vec::new();
    let mut imports: Vec<String> = Vec::new();
    let mut routes: Vec<String> = Vec::new();
    let mut db_ops: Vec<String> = Vec::new();
    let mut local_deps: Vec<String> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with('#') {
            continue;
        }

        match language {
            "ts" | "js" => scan_ts_js_line(trimmed, &mut exports, &mut imports, &mut routes, &mut db_ops),
            "rs" => scan_rs_line(trimmed, &mut exports, &mut imports, &mut db_ops),
            _ => {}
        }
    }

    // Resolve local import paths
    if let Some(parent) = path.parent() {
        for imp in &imports {
            if imp.starts_with('.') || imp.starts_with('/') {
                // Try to resolve to a relative file path for the dependency graph
                let resolved = resolve_import(parent, imp);
                local_deps.push(resolved);
            }
        }
    }

    (exports, imports, routes, db_ops, local_deps)
}

fn scan_ts_js_line(
    trimmed: &str,
    exports: &mut Vec<String>,
    imports: &mut Vec<String>,
    routes: &mut Vec<String>,
    db_ops: &mut Vec<String>,
) {
    // Skip block comments and strings (simple approach — skip lines with = or template literals)
    if trimmed.starts_with('*') || trimmed.starts_with("/*") {
        return;
    }

    // Export declarations
    if let Some(after_export) = trimmed.strip_prefix("export ") {
        // export function foo, export const foo, export class Foo, export interface Foo, export type Foo
        let after_export = after_export.trim();
        if let Some(name) = after_export
            .split(|c: char| c.is_whitespace() || c == '(' || c == '{' || c == '<' || c == '=')
            .nth(1)
        {
            let name = name.trim().trim_matches(|c: char| c == ',' || c == ';' || c == '"' || c == '\'');
            if !name.is_empty() && name != "{" && name != "default" && !name.starts_with('*') {
                exports.push(name.to_string());
            }
        }
        // export default function foo
        if let Some(after_default) = after_export.strip_prefix("default ") {
            if let Some(name) = after_default
                .split(|c: char| c.is_whitespace() || c == '(')
                .nth(1)
                .filter(|n| !n.is_empty() && !n.starts_with("function") && !n.starts_with("class") && !n.starts_with('{'))
            {
                exports.push(format!("default:{}", name));
            }
        }
        // export { foo, bar } or export type { Foo }
        if let Some(brace_start) = after_export.find('{') {
            if let Some(brace_end) = after_export[brace_start..].find('}') {
                let inner = after_export[brace_start + 1..brace_start + brace_end].trim();
                for item in inner.split(',') {
                    let item = item.trim();
                    // handle "foo as bar" and "foo"
                    let name = item.split(" as ").next().unwrap_or(item).trim();
                    if !name.is_empty() && name != "type" {
                        exports.push(name.to_string());
                    }
                }
            }
        }
    }

    // Import declarations
    if trimmed.starts_with("import ") || trimmed.starts_with("import type ") {
        // Extract the module path (from "..." or from '...')
        for quote_char in &['"', '\''] {
            if let Some(start) = trimmed.find(*quote_char) {
                if let Some(end) = trimmed[start + 1..].find(*quote_char) {
                    let path = &trimmed[start + 1..start + 1 + end];
                    imports.push(path.to_string());
                    break;
                }
            }
        }
    }

    // require() calls
    if trimmed.contains("require(") {
        for quote_char in &['"', '\''] {
            if let Some(start) = trimmed.find(*quote_char) {
                if let Some(end) = trimmed[start + 1..].find(*quote_char) {
                    let path = &trimmed[start + 1..start + 1 + end];
                    imports.push(path.to_string());
                    break;
                }
            }
        }
    }

    // Route patterns (Express/Fastify/Next.js)
    let route_patterns = [
        (".get(", "GET"),
        (".post(", "POST"),
        (".put(", "PUT"),
        (".patch(", "PATCH"),
        (".delete(", "DELETE"),
        (".all(", "ALL"),
        (".route(", ""),
        ("router.get(", "GET"),
        ("router.post(", "POST"),
        ("router.put(", "PUT"),
        ("router.patch(", "PATCH"),
        ("router.delete(", "DELETE"),
    ];
    for (pattern, method) in &route_patterns {
        if let Some(pos) = trimmed.find(pattern) {
            let after = &trimmed[pos + pattern.len()..];
            // Try to extract the route path from the first string argument
            for quote_char in &['"', '\''] {
                if let Some(start) = after.find(*quote_char) {
                    if let Some(end) = after[start + 1..].find(*quote_char) {
                        let route = &after[start + 1..start + 1 + end];
                        if !route.starts_with(':') && !route.contains(' ') {
                            if method.is_empty() {
                                routes.push(route.to_string());
                            } else {
                                routes.push(format!("{} {}", method, route));
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    // DB operations (Prisma, Drizzle, Knex, Supabase)
    let db_keywords = [
        "prisma.",
        "db.",
        "knex(",
        "supabase.",
        "drizzle.",
    ];
    for kw in &db_keywords {
        if trimmed.contains(kw) {
            // Extract the method call name after the prefix
            if let Some(pos) = trimmed.find(kw) {
                let after = &trimmed[pos + kw.len()..];
                let method = after.split(|c: char| !c.is_alphanumeric() && c != '_')
                    .next()
                    .unwrap_or("")
                    .to_string();
                if !method.is_empty() {
                    db_ops.push(method);
                }
            }
        }
    }
}

fn scan_rs_line(
    trimmed: &str,
    exports: &mut Vec<String>,
    imports: &mut Vec<String>,
    db_ops: &mut Vec<String>,
) {
    // pub fn, pub struct, pub enum, pub trait, pub mod, pub type
    let Some(after_pub) = trimmed
        .strip_prefix("pub(crate) ")
        .or_else(|| trimmed.strip_prefix("pub(super) "))
        .or_else(|| trimmed.strip_prefix("pub "))
        .or_else(|| trimmed.strip_prefix("pub("))
    else {
        return;
    };
    let after_pub = after_pub.trim();
        if let Some(name) = after_pub
            .split(|c: char| c.is_whitespace() || c == '<' || c == '(' || c == ';' || c == '{' || c == '!')
            .nth(1)
        {
            let name = name.trim().trim_matches('"');
            if !name.is_empty() && name != "{" {
                let prefix = if after_pub.starts_with("fn ") { "fn:" }
                    else if after_pub.starts_with("struct ") { "struct:" }
                    else if after_pub.starts_with("enum ") { "enum:" }
                    else if after_pub.starts_with("trait ") { "trait:" }
                    else if after_pub.starts_with("mod ") { "mod:" }
                    else if after_pub.starts_with("type ") { "type:" }
                    else if after_pub.starts_with("unsafe ") { "unsafe_fn:" }
                    else { "" };
                exports.push(format!("{}{}", prefix, name));
            }
        }

    // use statements (local crate paths)
    if let Some(path) = trimmed.strip_prefix("use ") {
        let path = path.trim().trim_end_matches(';');
        if path.starts_with("crate::") || path.starts_with("super::") || path.starts_with("self::") {
            imports.push(path.to_string());
        }
    }

    // mod declarations
    if trimmed.starts_with("mod ") && !trimmed.contains(';') && !trimmed.starts_with("mod!") {
        // inline mod — body follows, not an import
    } else if let Some(name) = trimmed.strip_prefix("mod ") {
        let name = name.trim().trim_end_matches(';');
        if !name.is_empty() && !name.contains('{') && !name.contains('"') {
            imports.push(format!("mod:{}", name));
        }
    }

    // DB ops in Rust (sqlx, diesel, sea-orm, prisma)
    let db_kw = ["sqlx::", "diesel::", "sea_orm::", "prisma::"];
    for kw in &db_kw {
        if trimmed.contains(kw) {
            if let Some(pos) = trimmed.find(kw) {
                let after = &trimmed[pos + kw.len()..];
                let method = after.split(|c: char| !c.is_alphanumeric() && c != '_')
                    .next()
                    .unwrap_or("")
                    .to_string();
                if !method.is_empty() {
                    db_ops.push(format!("{}{}", kw.trim_end_matches("::"), method));
                }
            }
        }
    }
}

/// Resolve an import path to a relative workspace path
fn resolve_import(parent: &Path, import: &str) -> String {
    let import = import.trim();
    if import.is_empty() {
        return String::new();
    }
    let import_path = Path::new(import);
    let has_ext = import_path.extension().is_some();
    let full = if import.starts_with('/') {
        PathBuf::from(import.trim_start_matches('/'))
    } else {
        let mut p = parent.to_path_buf();
        p.push(import);
        p
    };

    // If the import already has a file extension, just check existence
    if has_ext {
        if full.exists() {
            return full.to_string_lossy().replace('\\', "/");
        }
        return import.to_string();
    }

    // Try common extensions
    let extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".rs", ".css", ".json"];
    for ext in &extensions {
        let candidate = if ext.is_empty() {
            full.clone()
        } else {
            let p = full.clone();
            // Use set_extension which replaces the extension
            if let Some(s) = p.to_string_lossy().as_ref().strip_suffix('/') {
                PathBuf::from(format!("{}{}", s, ext))
            } else {
                let s = p.to_string_lossy().to_string();
                PathBuf::from(format!("{}{}", s, ext))
            }
        };
        if candidate.exists() {
            return candidate.to_string_lossy().replace('\\', "/");
        }
    }
    import.to_string()
}

/// Walk a workspace directory and build the index.
pub fn build_index(workspace: &str) -> Result<CodebaseIndex, String> {
    let root = Path::new(workspace);
    if !root.is_dir() {
        return Err(format!("Workspace '{}' is not a valid directory", workspace));
    }

    let workspace_name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| workspace.to_string());

    let mut files: Vec<FileIndex> = Vec::new();
    let mut total_lines: u32 = 0;
    let now = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    // Simple gitignore-aware walk
    let ignore_patterns = load_gitignore_patterns(root);

    let mut dir_stack = vec![root.to_path_buf()];
    let mut visited = 0usize;

    while let Some(dir) = dir_stack.pop() {
        if visited > MAX_WALK_FILES {
            break;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            if should_ignore(&relative, &ignore_patterns) {
                continue;
            }

            if path.is_dir() {
                dir_stack.push(path);
                continue;
            }

            if !path.is_file() {
                continue;
            }

            visited += 1;

            let size = entry.metadata().ok().map(|m| m.len()).unwrap_or(0);
            if size > MAX_FILE_SIZE || size == 0 {
                continue;
            }

            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let language = classify_file(&path);
            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let lines = content.lines().count() as u32;
            total_lines += lines;

            let (exports, imports, routes, db_ops, deps) = scan_source_file(&path, &content);

            files.push(FileIndex {
                file: relative,
                language: language.to_string(),
                exports,
                imports,
                deps,
                routes,
                db_ops,
                lines,
                size,
                modified_ms,
            });
        }
    }

    // Build symbol index (reverse: symbol → file paths)
    let mut symbol_index: HashMap<String, Vec<String>> = HashMap::new();
    for f in &files {
        for export in &f.exports {
            symbol_index
                .entry(export.clone())
                .or_default()
                .push(f.file.clone());
        }
    }

    // Build reverse dependency index: file → dependents
    let mut reverse_deps: HashMap<String, Vec<String>> = HashMap::new();
    for f in &files {
        for dep in &f.deps {
            if !dep.is_empty() {
                reverse_deps
                    .entry(dep.clone())
                    .or_default()
                    .push(f.file.clone());
            }
        }
    }

    Ok(CodebaseIndex {
        version: INDEX_VERSION,
        workspace: workspace.to_string(),
        workspace_name,
        generated_at_ms: now,
        total_files: files.len() as u32,
        total_lines,
        files,
        symbol_index,
        reverse_deps,
    })
}

/// Render the index as a compact markdown manifest.
pub fn render_manifest(index: &CodebaseIndex) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "# Codebase Index — {}\n\n",
        index.workspace_name
    ));
    out.push_str(&format!(
        "_{} files, {} lines, generated at {}._\n\n",
        index.total_files,
        index.total_lines,
        chrono_or_epoch(index.generated_at_ms),
    ));

    // Group files by directory
    let mut by_dir: HashMap<String, Vec<&FileIndex>> = HashMap::new();
    for f in &index.files {
        let dir = f
            .file
            .rsplitn(2, '/')
            .last()
            .map(|d| if d.is_empty() { "." } else { d })
            .unwrap_or(".")
            .to_string();
        by_dir.entry(dir).or_default().push(f);
    }

    let mut dirs: Vec<&String> = by_dir.keys().collect();
    dirs.sort();

    for dir in dirs {
        let dir_files = &by_dir[dir];
        out.push_str(&format!("## {}/\n", dir));
        let mut sorted_files = dir_files.clone();
        sorted_files.sort_by(|a, b| a.file.cmp(&b.file));

        for f in sorted_files {
            let short_name = f.file.rsplit('/').next().unwrap_or(&f.file);
            out.push_str(&format!("### {}\n", short_name));

            if !f.exports.is_empty() {
                let exports_str = f.exports.join(", ");
                // Truncate long export lists
                let exports_short = if exports_str.len() > 200 {
                    format!("{}… ({} total)", &exports_str[..197], f.exports.len())
                } else {
                    exports_str
                };
                out.push_str(&format!("- exports: {}\n", exports_short));
            }

            if !f.imports.is_empty() && f.imports.len() <= 15 {
                let imports_str = f.imports.join(", ");
                if !imports_str.is_empty() {
                    out.push_str(&format!("- imports: {}\n", imports_str));
                }
            }

            if !f.deps.is_empty() {
                let deps_str = f.deps.join(", ");
                if !deps_str.is_empty() {
                    out.push_str(&format!("- deps: {}\n", deps_str));
                }
            }

            if !f.routes.is_empty() {
                let routes_str = f.routes.join(", ");
                out.push_str(&format!("- routes: {}\n", routes_str));
            }

            if !f.db_ops.is_empty() {
                let db_str: String = f.db_ops.iter()
                    .fold((String::new(), 0), |(mut acc, count), op| {
                        if count >= 5 { return (acc, count + 1); }
                        if !acc.is_empty() { acc.push_str(", "); }
                        acc.push_str(op);
                        (acc, count + 1)
                    }).0;
                if !db_str.is_empty() {
                    out.push_str(&format!("- db: {}\n", db_str));
                }
            }

            out.push_str(&format!("- lang: {}, {} lines\n", f.language, f.lines));
        }
        out.push('\n');
    }

    // Summary stats
    out.push_str("---\n\n");
    out.push_str(&format!(
        "#### Symbol index ({} symbols)\n\n",
        index.symbol_index.len()
    ));
    out.push_str(&format!(
        "#### Dependency graph: {} files tracked\n\n",
        index.reverse_deps.len()
    ));

    out
}

/// Tauri command: build or refresh the codebase index and return the manifest text.
#[tauri::command]
pub fn index_codebase(path: String) -> Result<String, String> {
    index_codebase_impl(&path)
}

/// Non-Tauri version for internal use (e.g. file watcher).
pub(crate) fn index_codebase_impl(path: &str) -> Result<String, String> {
    let index = build_index(path)?;
    Ok(render_manifest(&index))
}

/// Tauri command: get the structured index (JSON) for UI consumption.
#[tauri::command]
pub fn get_codebase_index_structured(path: String) -> Result<CodebaseIndex, String> {
    build_index(&path)
}

fn chrono_or_epoch(ms: u64) -> String {
    // Simple human-readable time without chrono dependency
    let secs = ms / 1000;
    let hours = (secs / 3600) % 24;
    let minutes = (secs / 60) % 60;
    let seconds = secs % 60;
    format!("{:02}:{:02}:{:02} UTC", hours, minutes, seconds)
}

/// Load .gitignore patterns from workspace root
fn load_gitignore_patterns(root: &Path) -> Vec<String> {
    let gitignore_path = root.join(".gitignore");
    let content = match fs::read_to_string(&gitignore_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    content
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with('!'))
        .filter(|l| !l.starts_with('/'))  // Skip absolute patterns for simplicity
        .map(|l| {
            // Remove trailing globstar
            l.trim_end_matches('/').to_string()
        })
        .collect()
}

/// Check if a relative path matches any gitignore-style pattern
fn should_ignore(relative: &str, patterns: &[String]) -> bool {
    // Always ignore node_modules, .git, target, dist, .next
    if relative.starts_with("node_modules/")
        || relative.starts_with(".git/")
        || relative.starts_with("target/")
        || relative.starts_with("dist/")
        || relative.starts_with(".next/")
        || relative.starts_with("build/")
        || relative.starts_with(".whim/")
    {
        return true;
    }

    // Hidden files/directories (except .whim config we might need)
    if relative.starts_with('.') && !relative.starts_with(".env") && relative != ".gitignore" {
        // But include .github/ .vscode/ etc.
        if !relative.starts_with(".github/") && !relative.starts_with(".vscode/") {
            return true;
        }
    }

    for pattern in patterns {
        if relative.contains(pattern) {
            return true;
        }
        // Check if file name matches
        if let Some(file_name) = relative.rsplit('/').next() {
            if file_name == pattern {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_files() {
        assert_eq!(classify_file(Path::new("foo.ts")), "ts");
        assert_eq!(classify_file(Path::new("foo.tsx")), "ts");
        assert_eq!(classify_file(Path::new("foo.rs")), "rs");
        assert_eq!(classify_file(Path::new("foo.json")), "json");
    }

    #[test]
    fn scan_ts_exports() {
        let (exports, _, _, _, _) = scan_source_file(
            Path::new("test.ts"),
            "export function hello() {}\nexport const world = 42;\nexport interface Foo {}\n",
        );
        assert!(exports.contains(&"hello".to_string()));
        assert!(exports.contains(&"world".to_string()));
        assert!(exports.contains(&"Foo".to_string()));
    }

    #[test]
    fn scan_ts_imports() {
        let (_, imports, _, _, _) = scan_source_file(
            Path::new("test.ts"),
            "import { foo } from './bar';\nimport type { Baz } from '../types';\n",
        );
        assert!(imports.contains(&"./bar".to_string()));
        assert!(imports.contains(&"../types".to_string()));
    }

    #[test]
    fn scan_rs_pub_items() {
        let (exports, _, _, _, _) = scan_source_file(
            Path::new("test.rs"),
            "pub fn hello() {}\npub struct User {}\npub enum Color {}\npub trait Logger {}\n",
        );
        assert!(exports.contains(&"fn:hello".to_string()));
        assert!(exports.contains(&"struct:User".to_string()));
        assert!(exports.contains(&"enum:Color".to_string()));
        assert!(exports.contains(&"trait:Logger".to_string()));
    }

    #[test]
    fn scan_rs_imports() {
        let (_, imports, _, _, _) = scan_source_file(
            Path::new("test.rs"),
            "use crate::backend::workspace;\nuse super::lock;\n",
        );
        assert!(imports.contains(&"crate::backend::workspace".to_string()));
        assert!(imports.contains(&"super::lock".to_string()));
    }

    #[test]
    fn scan_routes() {
        let (_, _, routes, _, _) = scan_source_file(
            Path::new("routes.ts"),
            "router.get('/api/users', handler);\napp.post('/api/items', create);\n",
        );
        assert!(routes.contains(&"GET /api/users".to_string()));
        assert!(routes.contains(&"POST /api/items".to_string()));
    }

    #[test]
    fn should_ignore_common() {
        let patterns = vec![];
        assert!(should_ignore("node_modules/foo/index.js", &patterns));
        assert!(should_ignore(".git/config", &patterns));
        assert!(should_ignore("target/debug/app", &patterns));
        assert!(!should_ignore("src/main.rs", &patterns));
    }

    #[test]
    fn gitignore_patterns_matched() {
        let patterns = vec!["__pycache__".to_string()];
        assert!(should_ignore("src/__pycache__/foo.py", &patterns));
    }

    #[test]
    fn index_builds_from_temp_dir() {
        let dir = std::env::temp_dir().join("whim-index-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("hello.ts"), "export function hello() {}").unwrap();
        fs::write(dir.join("main.rs"), "pub fn main() {}").unwrap();
        fs::write(dir.join("package.json"), "{}").unwrap();
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("node_modules/ignore.ts"), "export const x = 1;").unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(
            dir.join(".git/config"),
            "[core]\n\trepositoryformatversion = 0\n",
        )
        .unwrap();

        let index = build_index(dir.to_string_lossy().as_ref()).unwrap();
        assert_eq!(index.total_files, 3);
        assert!(index.files.iter().any(|f| f.file == "hello.ts"));
        assert!(index.files.iter().any(|f| f.file == "main.rs"));
        assert!(index.files.iter().any(|f| f.file == "package.json"));
        // node_modules and .git should be excluded
        assert!(!index.files.iter().any(|f| f.file.contains("node_modules")));
        assert!(!index.files.iter().any(|f| f.file.contains(".git")));

        let manifest = render_manifest(&index);
        assert!(manifest.contains("hello.ts"));
        assert!(manifest.contains("hello"));
        assert!(manifest.contains("main.rs"));
        assert!(manifest.contains("fn:main"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_manifest_for_empty_dir() {
        let dir = std::env::temp_dir().join("whim-index-empty-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let index = build_index(dir.to_string_lossy().as_ref()).unwrap();
        assert_eq!(index.total_files, 0);

        let manifest = render_manifest(&index);
        assert!(!manifest.is_empty());
        assert!(manifest.contains("0 files"));

        let _ = fs::remove_dir_all(&dir);
    }
}

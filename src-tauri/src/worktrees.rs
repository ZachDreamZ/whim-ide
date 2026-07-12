//! Git worktree contracts and safe parsing helpers.
//!
//! Process execution remains in `backend.rs`, where Whim's tracked-process and
//! cancellation machinery lives. This module owns only the portable data
//! contract and path/ref validation shared by the backend and agent harness.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_WORKTREE_NAME_LENGTH: usize = 64;
const MAX_REF_LENGTH: usize = 160;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub detached: bool,
    pub primary: bool,
    pub managed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGitWorktreeRequest {
    pub name: String,
    pub base_ref: Option<String>,
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedGitWorktree {
    pub path: PathBuf,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub detached: bool,
}

pub fn validate_worktree_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty()
        || name.len() > MAX_WORKTREE_NAME_LENGTH
        || name.starts_with('.')
        || name.ends_with('.')
        || name.contains("..")
        || !name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
    {
        return Err("Worktree name must use letters, numbers, hyphens, or underscores".to_string());
    }
    Ok(name.to_string())
}

pub fn validate_git_ref(value: &str) -> Result<String, String> {
    let reference = value.trim();
    if reference.is_empty()
        || reference.len() > MAX_REF_LENGTH
        || reference.starts_with('-')
        || reference.starts_with('/')
        || reference.ends_with('/')
        || reference.contains("..")
        || reference.contains("@{")
        || reference.contains("//")
        || !reference
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_/.:".contains(character))
    {
        return Err("Git base reference contains unsupported characters".to_string());
    }
    Ok(reference.to_string())
}

pub fn parse_worktree_porcelain(output: &str) -> Vec<ParsedGitWorktree> {
    let mut worktrees = Vec::new();
    let mut current: Option<ParsedGitWorktree> = None;

    let flush = |current: &mut Option<ParsedGitWorktree>,
                 worktrees: &mut Vec<ParsedGitWorktree>| {
        if let Some(worktree) = current.take() {
            worktrees.push(worktree);
        }
    };

    for line in output.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            flush(&mut current, &mut worktrees);
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            flush(&mut current, &mut worktrees);
            current = Some(ParsedGitWorktree {
                path: PathBuf::from(path),
                branch: None,
                head: None,
                detached: false,
            });
            continue;
        }
        let Some(worktree) = current.as_mut() else {
            continue;
        };
        if let Some(head) = line.strip_prefix("HEAD ") {
            worktree.head = (!head.is_empty()).then(|| head.to_string());
        } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            worktree.branch = (!branch.is_empty()).then(|| branch.to_string());
        } else if line == "detached" {
            worktree.detached = true;
        }
    }
    flush(&mut current, &mut worktrees);
    worktrees
}

pub fn managed_worktree_root(repo_root: &Path) -> Result<PathBuf, String> {
    let repository_name = repo_root
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "repository".to_string());
    let repository_name =
        validate_worktree_name(&repository_name).unwrap_or_else(|_| "repository".to_string());
    let parent = repo_root.parent().ok_or_else(|| {
        "Cannot determine a managed worktree directory for this repository".to_string()
    })?;
    Ok(parent.join(".whim-worktrees").join(repository_name))
}

pub fn is_managed_worktree(path: &Path, managed_root: &Path) -> bool {
    path.starts_with(managed_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_names_and_refs_without_shell_syntax() {
        assert_eq!(
            validate_worktree_name("review_agent").unwrap(),
            "review_agent"
        );
        assert!(validate_worktree_name("../escape").is_err());
        assert!(validate_worktree_name("agent; Remove-Item").is_err());
        assert_eq!(validate_git_ref("origin/main").unwrap(), "origin/main");
        assert!(validate_git_ref("HEAD~1").is_err());
        assert!(validate_git_ref("--upload-pack=cmd").is_err());
    }

    #[test]
    fn parses_git_worktree_porcelain_without_assuming_branch_presence() {
        let parsed = parse_worktree_porcelain(
            "worktree C:/repo\nHEAD aaa111\nbranch refs/heads/main\n\nworktree C:/repo/.whim-worktrees/repo/review\nHEAD bbb222\ndetached\n\n",
        );

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].branch.as_deref(), Some("main"));
        assert!(!parsed[0].detached);
        assert_eq!(parsed[1].head.as_deref(), Some("bbb222"));
        assert!(parsed[1].detached);
    }
}

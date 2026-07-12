const fs = require('fs');
const path = require('path');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

const targets = [
    { name: 'git_repository_root', term: 'async fn git_repository_root' },
    { name: 'git_worktrees_for_repository', term: 'async fn git_worktrees_for_repository' },
    { name: 'list_git_worktrees', term: 'pub async fn list_git_worktrees' },
    { name: 'create_git_worktree', term: 'pub async fn create_git_worktree' },
    { name: 'inspect_worktree_candidate', term: 'pub async fn inspect_worktree_candidate' },
    { name: 'workspace_checkpoint', term: 'pub async fn workspace_checkpoint' },
    { name: 'workspace_rollback', term: 'pub async fn workspace_rollback' },
    { name: 'install_dependencies', term: 'pub async fn install_dependencies' },
    { name: 'start_local_preview', term: 'pub async fn start_local_preview' },
    { name: 'start_tunnel', term: 'pub async fn start_tunnel' },
    { name: 'discover_providers', term: 'pub fn discover_providers' }
];

targets.forEach(t => {
    let idx = content.indexOf(t.term);
    if (idx !== -1) {
        console.log(`=== ${t.name} ===`);
        console.log(content.substring(idx - 50, idx + 1800).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    } else {
        // Search without pub
        let term2 = t.term.replace('pub ', '');
        idx = content.indexOf(term2);
        if (idx !== -1) {
            console.log(`=== ${t.name} (fallback) ===`);
            console.log(content.substring(idx - 50, idx + 1800).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
        } else {
            console.log(`=== ${t.name} NOT found ===`);
        }
    }
});

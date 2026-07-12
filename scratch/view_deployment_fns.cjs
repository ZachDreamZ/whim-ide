const fs = require('fs');

const content = fs.readFileSync('src-tauri/src/backend.rs.bak', 'utf8');

const fns = [
    'git_output',
    'git_repository_root',
    'git_worktrees_for_repository',
    'list_git_worktrees',
    'create_git_worktree',
    'inspect_worktree_candidate',
    'discover_verification_plan',
    'deploy_preflight',
    'deploy_workspace',
    'workspace_checkpoint',
    'workspace_rollback',
    'install_dependencies',
    'start_local_preview',
    'start_tunnel',
    'discover_providers'
];

fns.forEach(name => {
    const idx = content.indexOf(name);
    if (idx !== -1) {
        console.log(`=== Function: ${name} ===`);
        console.log(content.substring(idx - 100, idx + 600));
    } else {
        console.log(`=== Function: ${name} NOT found ===`);
    }
});

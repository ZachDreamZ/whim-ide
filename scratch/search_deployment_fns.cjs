const fs = require('fs');
const path = require('path');

const glob = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(glob(file));
        } else if (file.endsWith('.jsonl')) {
            results.push(file);
        }
    });
    return results;
};

const files = glob('C:/Users/Vendex/.codex/sessions');
console.log('Found', files.length, 'session files.');

const targetFns = [
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

for (const file of files) {
    if (!file.includes('019f50ee-0070-7e90-bf1d-3381e7438661')) continue;
    try {
        const content = fs.readFileSync(file, 'utf8');
        targetFns.forEach(fn => {
            let pos = 0;
            while (pos < content.length) {
                const idx = content.indexOf(fn, pos);
                if (idx === -1) break;
                const context = content.substring(idx - 100, idx + 800);
                if (context.includes('async fn ' + fn) || context.includes('pub async fn ' + fn) || context.includes('pub fn ' + fn)) {
                    console.log(`=== Match in ${path.basename(file)}: ${fn} ===`);
                    console.log(context.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
                    break;
                }
                pos = idx + 1;
            }
        });
    } catch (e) {}
}

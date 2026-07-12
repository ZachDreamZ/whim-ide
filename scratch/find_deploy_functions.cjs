const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Search for the deploy_command_line, install_dependencies, start_local_preview, start_tunnel functions
const terms = [
    'fn deploy_command_line',
    'fn build_deploy_command',
    'fn install_dependencies',
    'fn start_local_preview',
    'fn start_local_preview_at',
    'fn start_tunnel',
    'fn start_tunnel_at',
    'fn deploy_workspace',
    'fn deploy_preflight_internal',
];

for (const term of terms) {
    const idx = content.indexOf(term);
    if (idx !== -1) {
        console.log(`\n=== ${term} at ${idx} ===`);
        console.log(content.substring(idx - 100, idx + 2000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    } else {
        console.log(`NOT FOUND: ${term}`);
    }
}

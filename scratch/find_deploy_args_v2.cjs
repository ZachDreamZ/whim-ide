const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Search for the code section that has deploy_args and mode combinations
// The function is referenced in deploy_workspace as "deploy_args(&root, request.target, request.mode, &options)?"
// So search for the exact definition pattern
const patterns = [
    'deploy_args(',
    'fn build_deploy',
    'fn planned_deploy_command',
    'DeployTarget::Vercel =\\u003e',
    'DeployTarget::Vercel =\\u003e {\\\\r\\\\n'
];

for (const pat of patterns) {
    const idx = content.indexOf(pat);
    if (idx !== -1) {
        console.log(`\n=== ${pat} at ${idx} ===`);
        break;
    }
}

// Let me just search for "let args = deploy_args" which we saw in deploy_workspace
const idx = content.indexOf('let args = deploy_args');
if (idx !== -1) {
    // Go backwards to find the deploy_args function definition
    // Search from the same occurrence backwards for a function definition
    const before = content.substring(Math.max(0, idx - 10000), idx);
    const fnIdx = before.lastIndexOf('fn deploy_args');
    if (fnIdx !== -1) {
        console.log(`=== deploy_args function found at ${fnIdx} in before-context ===`);
        console.log(before.substring(fnIdx).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    } else {
        console.log('deploy_args function not found in before-context');
        // Try broader search
        const fnIdx2 = before.lastIndexOf('deploy_args');
        console.log(`last deploy_args in before-context at ${fnIdx2}`);
    }
}

const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Find the shell_command output that reads lines 1940-2070 (deploy section)
const idx = content.indexOf('backend.rs:1940');
if (idx !== -1) {
    console.log(content.substring(idx - 500, idx + 5000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
} else {
    // Try to find deploy_preflight_internal as a function definition
    const idx2 = content.indexOf('deploy_preflight_internal(');
    console.log(`deploy_preflight_internal at ${idx2}`);
    if (idx2 !== -1) {
        console.log(content.substring(idx2 - 500, idx2 + 3000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    }
}

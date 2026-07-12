const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Find the shell command output that gets backend.rs lines 1940-2100
const searchFor = 'fn deploy_args(';
const idx = content.indexOf(searchFor);
if (idx !== -1) {
    console.log(content.substring(idx - 500, idx + 6000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
} else {
    console.log('NOT FOUND');
}

const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

const targetIdx = content.indexOf('inspect_worktree_candidate');
if (targetIdx !== -1) {
    console.log(content.substring(targetIdx + 3000, targetIdx + 8000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
} else {
    console.log('not found');
}

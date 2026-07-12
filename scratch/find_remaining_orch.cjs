const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

const terms = [
    ['record_verification_result', 4000],
    ['list_project_orchestration_jobs', 4000],
    ['orchestration_workspace(state', 2000],
];

for (const [term, size] of terms) {
    let idx = content.indexOf(term);
    if (idx !== -1) {
        console.log(`\n=== ${term} at ${idx} ===`);
        console.log(content.substring(idx - 300, idx + size).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    } else {
        console.log(`NOT FOUND: ${term}`);
    }
}

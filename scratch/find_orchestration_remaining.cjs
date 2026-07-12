const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Get the full orchestration section - find the Get-Content output section
const terms = [
    ['fn orchestration_workspace(', 3000],
    ['fn record_verification_result', 3000],
    ['fn retry_orchestration_job', 3000],
    ['fn create_orchestration_job', 4000],
];

for (const [term, size] of terms) {
    // Find in the Get-Content output sections (line numbers like "2225:")
    let idx = content.indexOf(term);
    if (idx !== -1) {
        console.log(`\n=== ${term} at ${idx} ===`);
        console.log(content.substring(idx - 300, idx + size).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    } else {
        console.log(`NOT FOUND: ${term}`);
    }
}

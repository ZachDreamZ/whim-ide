const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Find orchestration_workspace, create_orchestration_job, dispatch_orchestration_job
const terms = [
    'fn orchestration_workspace',
    'fn create_orchestration_job',
    'fn dispatch_orchestration_job',
    'fn finish_background_agent',
];

for (const term of terms) {
    // Find in a Get-Content/shell output context
    const idx = content.indexOf(term);
    if (idx !== -1) {
        console.log(`\n=== ${term} at ${idx} ===`);
        console.log(content.substring(idx - 200, idx + 3000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    } else {
        console.log(`NOT FOUND: ${term}`);
    }
}

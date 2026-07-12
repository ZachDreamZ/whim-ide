const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Find "fn deploy_args" in the shell output section (not the test section)
// We need the function body, not just references
const idx = content.indexOf('Select-Object -Skip 1907');
if (idx !== -1) {
    console.log(content.substring(idx - 100, idx + 8000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
} else {
    // Try 'Select-Object -Skip' to find relevant shell reads
    const idx2 = content.indexOf('deploy_mode_supported');
    console.log(`deploy_mode_supported at ${idx2}`);
    if (idx2 !== -1) {
        console.log(content.substring(idx2 + 0, idx2 + 8000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    }
}

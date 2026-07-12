const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Look for the original backend.rs between lines 1940-2070 which had deploy_args
// and related functions. Let's search for "deploy_args" directly.
let idx = 0;
let count = 0;
while ((idx = content.indexOf('deploy_args', idx)) !== -1) {
    count++;
    if (count <= 5) {
        console.log(`\n=== Occurrence #${count} at ${idx} ===`);
        console.log(content.substring(idx - 100, idx + 500).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    }
    idx += 11;
}
console.log(`\nTotal occurrences: ${count}`);

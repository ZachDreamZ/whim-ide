const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// search for record_verification broadly
let idx = 0;
let count = 0;
while ((idx = content.indexOf('record_verification', idx)) !== -1 && count < 10) {
    count++;
    const context = content.substring(idx - 100, idx + 500);
    if (context.includes('fn ') || context.includes('pub ')) {
        console.log(`\n=== Occurrence #${count} at ${idx} ===`);
        console.log(context.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    }
    idx += 20;
}
console.log(`\nTotal found: ${count}`);

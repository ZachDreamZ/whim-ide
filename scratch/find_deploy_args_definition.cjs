const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Search for "fn deploy_args" directly in a Get-Content output
const search = 'fn deploy_args(';
let pos = 0;
let count = 0;
while ((pos = content.indexOf(search, pos)) !== -1) {
    count++;
    // Check if this is in code output (Get-Content) or test
    const context = content.substring(pos - 300, pos + 100);
    const isTest = context.includes('tests::');
    const isShellOutput = context.includes('Exit code') || context.includes('Output:');
    const isCodeLine = context.includes(':19') || context.includes(':20');
    
    if (!isTest) {
        console.log(`\n=== Occurrence #${count} at ${pos} (isShell=${isShellOutput}, isCode=${isCodeLine}) ===`);
        console.log(content.substring(pos - 100, pos + 3000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
        break;
    }
    pos += search.length;
}
console.log(`\nTotal scanned: ${count}`);

const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

const search = 'pub async fn workspace_checkpoint';
let pos = 0;
while (true) {
    const idx = content.indexOf(search, pos);
    if (idx === -1) break;
    // Find the enclosing double quotes
    let quoteStart = -1;
    for (let i = idx; i >= 0; i--) {
        if (content[i] === '"') {
            let escapeCount = 0;
            for (let j = i - 1; j >= 0; j--) {
                if (content[j] === '\\') escapeCount++;
                else break;
            }
            if (escapeCount % 2 === 0) {
                quoteStart = i;
                break;
            }
        }
    }

    let quoteEnd = -1;
    for (let i = idx; i < content.length; i++) {
        if (content[i] === '"') {
            let escapeCount = 0;
            for (let j = i - 1; j >= 0; j--) {
                if (content[j] === '\\') escapeCount++;
                else break;
            }
            if (escapeCount % 2 === 0) {
                quoteEnd = i;
                break;
            }
        }
    }

    if (quoteStart !== -1 && quoteEnd !== -1) {
        const raw = content.substring(quoteStart + 1, quoteEnd);
        const clean = raw
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
        console.log(`=== Patch at ${quoteStart} (length: ${clean.length}) ===`);
        console.log(clean.slice(0, 4000));
        console.log('...');
        console.log(clean.slice(-1000));
    }
    pos = idx + 1;
}

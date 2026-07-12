const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/10/rollout-2026-07-10T15-21-44-019f4ae7-48e7-7aa2-b6d2-e0d8b8240314.jsonl';
const content = fs.readFileSync(file, 'utf8');

const targetStr = '*** Add File:';
const idx = content.indexOf(targetStr);

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

const raw = content.substring(idx, quoteEnd);
const firstLines = raw.split('\n');
console.log('Line 0:', JSON.stringify(firstLines[0]));
console.log('Line 1:', JSON.stringify(firstLines[1]));
console.log('Line 2:', JSON.stringify(firstLines[2]));

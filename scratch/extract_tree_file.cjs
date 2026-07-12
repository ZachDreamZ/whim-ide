const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

const targetIdx = 4122753;

// Find double quotes before and after targetIdx
let quoteStart = -1;
for (let i = targetIdx; i >= 0; i--) {
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
for (let i = targetIdx; i < content.length; i++) {
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

console.log(`quoteStart: ${quoteStart}, quoteEnd: ${quoteEnd}, length: ${quoteEnd - quoteStart - 1}`);

if (quoteStart !== -1 && quoteEnd !== -1) {
    const raw = content.substring(quoteStart + 1, quoteEnd);
    const clean = raw
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    
    console.log('Clean length:', clean.length);
    console.log('First 500 chars:', clean.slice(0, 500));
    console.log('Last 500 chars:', clean.slice(-500));
    
    // Save to backup
    fs.writeFileSync('src-tauri/src/backend.rs', clean, 'utf8');
    console.log('Successfully wrote backend.rs');
}

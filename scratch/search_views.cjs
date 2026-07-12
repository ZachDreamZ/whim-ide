const fs = require('fs');
const readline = require('readline');

const files = [
    'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl',
    'C:/Users/Vendex/.codex/sessions/2026/07/12/rollout-2026-07-12T08-44-06-019f53c7-f61c-7cb1-966b-23b6a9852ec0.jsonl',
    'C:/Users/Vendex/.codex/sessions/2026/07/12/rollout-2026-07-12T09-03-32-019f53d9-c84a-7f41-818f-c67f6dbb177e.jsonl'
];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    console.log('Searching', file);
    const content = fs.readFileSync(file, 'utf8');
    
    // Find all occurrences of 'view_file' or 'read_file' or 'replace_file_content'
    // where the target path is backend.rs, and print their index/contexts.
    let pos = 0;
    while (true) {
        const idx = content.indexOf('backend.rs', pos);
        if (idx === -1) break;
        
        console.log(`- Found backend.rs reference at index ${idx}:`, content.substring(idx - 150, idx + 150));
        pos = idx + 1;
    }
}
console.log('Done.');

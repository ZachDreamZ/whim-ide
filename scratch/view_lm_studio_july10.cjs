const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/10/rollout-2026-07-10T15-21-44-019f4ae7-48e7-7aa2-b6d2-e0d8b8240314.jsonl';
const content = fs.readFileSync(file, 'utf8');

const targetIdx = content.indexOf('lm_studio_models = lm_studio_json');
if (targetIdx !== -1) {
    console.log(content.substring(targetIdx, targetIdx + 2000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
} else {
    console.log('not found');
}

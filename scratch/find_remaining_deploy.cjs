const fs = require('fs');

const file = 'C:/Users/Vendex/.codex/sessions/2026/07/11/rollout-2026-07-11T19-26-47-019f50ee-0070-7e90-bf1d-3381e7438661.jsonl';
const content = fs.readFileSync(file, 'utf8');

// Get the full text of the original backend.rs (line 2029-2380 approx)
const terms = [
    ['fn deploy_args', 5000],
    ['fn deploy_preflight', 5000],
    ['fn deploy_workspace', 5000],
    ['fn validate_package_name', 3000],
    ['fn install_dependencies', 5000],
    ['fn discover_providers', 3000],
];

for (const [term, size] of terms) {
    const idx = content.indexOf(term);
    if (idx !== -1) {
        // Find in the actual backend.rs content, not in the patch diffs
        // Search for the version that appears in shell_command output
        const search2 = `pub ${term}`;
        const idx2 = content.indexOf(`\n${term}(`) || content.indexOf(`:${term}(`);
        console.log(`\n=== ${term} at ${idx} ===`);
        console.log(content.substring(idx - 200, idx + size).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
    } else {
        console.log(`NOT FOUND: ${term}`);
    }
}

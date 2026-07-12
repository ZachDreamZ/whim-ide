const fs = require('fs');

const content = fs.readFileSync('src-tauri/src/backend.rs.bak', 'utf8');

const fns = [
    'selected_workspace',
    'selected_workspace_path',
    'resolve_existing',
    'ensure_inside',
    'sanitize_relative',
    'canonical_workspace',
    'workspace_info'
];

fns.forEach(name => {
    const idx = content.indexOf(name);
    if (idx !== -1) {
        console.log(`=== Function: ${name} ===`);
        console.log(content.substring(idx - 100, idx + 600));
    } else {
        console.log(`=== Function: ${name} NOT found ===`);
    }
});

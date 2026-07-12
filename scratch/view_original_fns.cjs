const fs = require('fs');

const content = fs.readFileSync('src-tauri/src/backend.rs.bak', 'utf8');

const fns = [
    'ensure_directory_chain',
    'resolve_write_target',
    'relative_display',
    'modified_ms',
    'file_entry',
    'sorted_children',
    'TreeOptions',
    'collect_tree',
    'list_workspace',
    'list_workspace_tree'
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

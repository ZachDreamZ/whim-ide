const fs = require('fs');

const content = fs.readFileSync('src-tauri/src/backend/workspace.rs', 'utf8');
const lines = content.split('\n');

console.log('Total lines in workspace.rs:', lines.length);

// Let's print occurrences of select_workspace or selected_workspace
lines.forEach((l, i) => {
    if (l.includes('selected_workspace') || l.includes('selected_workspace_path')) {
        console.log(`${i+1}: ${l}`);
    }
});

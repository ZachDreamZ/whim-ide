const fs = require('fs');

const content = fs.readFileSync('src-tauri/src/backend.rs.bak', 'utf8');

const fns = [
    'execute_tracked',
    'cancel_operation',
    'list_active_operations',
    'run_powershell_command',
    'run_powershell_command_at',
    'quick_capture',
    'quick_capture_with_environment',
    'preferred_powershell',
    'powershell_args',
    'tool_script',
    'hide_console'
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

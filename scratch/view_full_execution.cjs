const fs = require('fs');

const content = fs.readFileSync('src-tauri/src/backend.rs.bak', 'utf8');

const targetIdx = content.indexOf('quick_capture_with_environment');
if (targetIdx !== -1) {
    console.log(content.substring(targetIdx - 100, targetIdx + 1200));
} else {
    console.log('quick_capture_with_environment not found');
}

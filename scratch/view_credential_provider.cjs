const fs = require('fs');

const content = fs.readFileSync('src-tauri/src/backend.rs.bak', 'utf8');

const target1 = content.indexOf('fn credential_provider');
if (target1 !== -1) {
    console.log(content.substring(target1, target1 + 2000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
} else {
    console.log('not found');
}

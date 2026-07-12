const fs = require('fs');

const content = fs.readFileSync('src-tauri/src/backend.rs.bak', 'utf8');

const target1 = content.indexOf('fn credential_provider');
if (target1 !== -1) {
    console.log('=== credential_provider ===');
    console.log(content.substring(target1, target1 + 1000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
} else {
    console.log('credential_provider not found');
}

const target2 = content.indexOf('fn parse_env_names');
if (target2 !== -1) {
    console.log('=== parse_env_names ===');
    console.log(content.substring(target2, target2 + 1000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
} else {
    console.log('parse_env_names not found');
}

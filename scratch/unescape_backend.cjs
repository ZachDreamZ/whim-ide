const fs = require('fs');

const file = 'src-tauri/src/backend.rs';
const content = fs.readFileSync(file, 'utf8');

const clean = content
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');

fs.writeFileSync(file, clean, 'utf8');
console.log('Unescaped backend.rs successfully!');

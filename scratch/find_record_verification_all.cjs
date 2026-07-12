const fs = require('fs');
const path = require('path');

const glob = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(glob(file));
        } else if (file.endsWith('.jsonl')) {
            results.push(file);
        }
    });
    return results;
};

const files = glob('C:/Users/Vendex/.codex/sessions');

for (const file of files) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        const idx = content.indexOf('record_verification');
        if (idx !== -1) {
            console.log(`\n=== Match in ${path.basename(file)} at ${idx} ===`);
            console.log(content.substring(idx - 200, idx + 1000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
        }
    } catch (e) {}
}

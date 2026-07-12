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
console.log('Searching all session logs...');

for (const file of files) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('backend.rs')) {
            console.log(`- Match in ${path.basename(file)}:`);
            // Find occurrences and print type (Add/Update File)
            let pos = 0;
            while (true) {
                const idx = content.indexOf('backend.rs', pos);
                if (idx === -1) break;
                console.log(`  at index ${idx}:`, content.substring(idx - 100, idx + 100).replace(/\n/g, ' '));
                pos = idx + 1;
            }
        }
    } catch (e) {}
}

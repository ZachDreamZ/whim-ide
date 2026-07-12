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
console.log('Found', files.length, 'session files.');

for (const file of files) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('TreeOptions')) {
            console.log(`Match in ${path.basename(file)}:`);
            let pos = 0;
            while (true) {
                const idx = content.indexOf('TreeOptions', pos);
                if (idx === -1) break;
                console.log(`  at index ${idx}:`, content.substring(idx - 100, idx + 200).replace(/\n/g, ' '));
                pos = idx + 1;
            }
        }
    } catch (e) {}
}

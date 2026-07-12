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

let matches = [];

function search(obj, file) {
    if (!obj) return;
    if (typeof obj === 'string') {
        if (obj.includes('impl BackendState')) {
            matches.push({
                file: file,
                length: obj.length,
                preview: obj.slice(0, 300)
            });
        }
    } else if (Array.isArray(obj)) {
        obj.forEach(x => search(x, file));
    } else if (typeof obj === 'object') {
        Object.values(obj).forEach(x => search(x, file));
    }
}

for (const file of files) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        
        lines.forEach((line) => {
            if (line.includes('impl BackendState')) {
                try {
                    const obj = JSON.parse(line);
                    search(obj, file);
                } catch (e) {}
            }
        });
    } catch (e) {}
}

// Sort by length desc
matches.sort((a, b) => b.length - a.length);

console.log('Matches count:', matches.length);
matches.slice(0, 15).forEach((m, idx) => {
    console.log(`${idx}: ${path.basename(m.file)} - length: ${m.length} - preview: ${m.preview.replace(/\n/g, ' ')}`);
});

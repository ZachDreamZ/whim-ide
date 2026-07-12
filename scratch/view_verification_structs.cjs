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
        const term1 = 'pub struct VerificationCheck';
        const term2 = 'pub struct VerificationPlan';
        let idx1 = content.indexOf(term1);
        if (idx1 !== -1) {
            console.log(`=== Match in ${path.basename(file)} (VerificationCheck) ===`);
            console.log(content.substring(idx1 - 100, idx1 + 1000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
        }
        let idx2 = content.indexOf(term2);
        if (idx2 !== -1) {
            console.log(`=== Match in ${path.basename(file)} (VerificationPlan) ===`);
            console.log(content.substring(idx2 - 100, idx2 + 1000).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
        }
    } catch (e) {}
}

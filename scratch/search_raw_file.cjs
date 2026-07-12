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

let bestLength = 0;
let bestClean = null;
let bestFile = null;

for (const file of files) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        const searchStr = 'pub struct BackendState';
        let pos = 0;
        
        while (true) {
            const idx = content.indexOf(searchStr, pos);
            if (idx === -1) break;
            
            // Find double quotes before and after idx
            let quoteStart = -1;
            for (let i = idx; i >= 0; i--) {
                if (content[i] === '"') {
                    let escapeCount = 0;
                    for (let j = i - 1; j >= 0; j--) {
                        if (content[j] === '\\') escapeCount++;
                        else break;
                    }
                    if (escapeCount % 2 === 0) {
                        quoteStart = i;
                        break;
                    }
                }
            }

            let quoteEnd = -1;
            for (let i = idx; i < content.length; i++) {
                if (content[i] === '"') {
                    let escapeCount = 0;
                    for (let j = i - 1; j >= 0; j--) {
                        if (content[j] === '\\') escapeCount++;
                        else break;
                    }
                    if (escapeCount % 2 === 0) {
                        quoteEnd = i;
                        break;
                    }
                }
            }

            if (quoteStart !== -1 && quoteEnd !== -1) {
                const raw = content.substring(quoteStart + 1, quoteEnd);
                const clean = raw
                    .replace(/\\r\\n/g, '\n')
                    .replace(/\\n/g, '\n')
                    .replace(/\\r/g, '\r')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\');
                
                // Check if it's a raw Rust file (no line numbers, contains tauri::command or std::path)
                const firstLines = clean.slice(0, 1000);
                const isGrep = /^\s*\d+[:-]/m.test(firstLines) || firstLines.includes('Exit code:') || firstLines.includes('Output:');
                
                if (!isGrep && clean.includes('fn ') && clean.length > 20000) {
                    console.log(`Candidate in ${path.basename(file)}: length ${clean.length}, preview: ${clean.slice(0, 100).replace(/\n/g, ' ')}`);
                    if (clean.length > bestLength) {
                        bestLength = clean.length;
                        bestClean = clean;
                        bestFile = file;
                    }
                }
            }
            
            pos = idx + 1;
        }
    } catch (e) {}
}

if (bestClean) {
    console.log('Writing best raw backend.rs of length:', bestLength, 'from', bestFile);
    fs.writeFileSync('src-tauri/src/backend.rs', bestClean, 'utf8');
} else {
    console.log('No matches found.');
}

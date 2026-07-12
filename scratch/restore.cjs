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

let candidates = [];

for (const file of files) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        const targetStr = '*** Add File:';
        let pos = 0;
        
        while (true) {
            const idx = content.indexOf(targetStr, pos);
            if (idx === -1) break;
            
            // Find unescaped closing quote
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

            if (quoteEnd !== -1) {
                const raw = content.substring(idx, quoteEnd);
                if (raw.includes('backend.rs')) {
                    const cleanLines = raw
                        .replace(/\\r\\n/g, '\n')
                        .replace(/\\n/g, '\n')
                        .replace(/\\r/g, '\r')
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, '\\')
                        .split('\n');
                    
                    const rustLines = [];
                    let collecting = false;
                    for (const line of cleanLines) {
                        if (line.includes('*** Add File') && line.includes('backend.rs')) {
                            collecting = true;
                            continue;
                        }
                        if (collecting) {
                            if (line.startsWith('***') || line.startsWith('===') || line.includes('End Patch')) {
                                collecting = false;
                                break;
                            }
                            if (line.startsWith('+')) {
                                rustLines.push(line.substring(1));
                            } else {
                                rustLines.push(line);
                            }
                        }
                    }
                    if (rustLines.length > 500) {
                        candidates.push({
                            file: file,
                            linesCount: rustLines.length,
                            rustCode: rustLines.join('\n'),
                            mtime: fs.statSync(file).mtime
                        });
                    }
                }
            }
            pos = idx + 1;
        }
    } catch (e) {
        // Ignore
    }
}

// Sort candidates by linesCount desc, then mtime desc
candidates.sort((a, b) => b.linesCount - a.linesCount || b.mtime - a.mtime);

console.log('Found', candidates.length, 'candidates:');
candidates.forEach((c, idx) => {
    console.log(`${idx}: ${path.basename(c.file)} - lines: ${c.linesCount} - mtime: ${c.mtime}`);
});

if (candidates.length > 0) {
    const best = candidates[0];
    console.log('Writing best candidate to src-tauri/src/backend.rs. Length:', best.linesCount);
    fs.writeFileSync('src-tauri/src/backend.rs', best.rustCode, 'utf8');
}

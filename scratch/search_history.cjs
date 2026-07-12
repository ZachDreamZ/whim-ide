const fs = require('fs');
const path = require('path');

const searchDirs = [
    process.env.APPDATA || '',
    process.env.LOCALAPPDATA || '',
];

console.log('Searching in AppData directories for ANY file containing pub struct BackendState...');

const scan = () => {
    let count = 0;
    let candidates = [];
    
    const recurse = (current) => {
        try {
            const list = fs.readdirSync(current);
            for (const file of list) {
                const fullPath = path.join(current, file);
                const stat = fs.statSync(fullPath);
                if (stat && stat.isDirectory()) {
                    if (file !== 'node_modules' && file !== 'target' && file !== '.git' && 
                        file !== 'Cache' && file !== 'CachedData' && file !== 'logs' && 
                        file !== 'Temp' && file !== 'crash' && file !== 'CachedExtensions') {
                        recurse(fullPath);
                    }
                } else if (stat && stat.isFile()) {
                    if (file.endsWith('.rs') || file.endsWith('.txt') || file.endsWith('.json') || !file.includes('.')) {
                        try {
                            // Only read first 1000 bytes first to check
                            const fd = fs.openSync(fullPath, 'r');
                            const buf = Buffer.alloc(4096);
                            const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
                            fs.closeSync(fd);
                            
                            const contentHead = buf.toString('utf8', 0, bytesRead);
                            if (contentHead.includes('BackendState') || contentHead.includes('selected_workspace')) {
                                // Read the full file
                                const content = fs.readFileSync(fullPath, 'utf8');
                                if (content.includes('pub struct BackendState') && content.includes('pub async fn select_workspace')) {
                                    candidates.push({
                                        path: fullPath,
                                        size: stat.size,
                                        mtime: stat.mtime,
                                        content: content
                                    });
                                    count++;
                                }
                            }
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {}
    };
    
    for (const d of searchDirs) {
        if (fs.existsSync(d)) {
            console.log('Scanning', d);
            recurse(d);
        }
    }
    
    candidates.sort((a, b) => b.mtime - a.mtime);
    
    console.log(`Scan completed. Found ${count} backups.`);
    candidates.forEach((c, idx) => {
        console.log(`${idx}: ${c.path} - size: ${c.size} - mtime: ${c.mtime}`);
    });
    
    if (candidates.length > 0) {
        fs.writeFileSync('src-tauri/src/backend.rs', candidates[0].content, 'utf8');
        console.log('Successfully restored file to src-tauri/src/backend.rs from:', candidates[0].path);
    }
};

scan();

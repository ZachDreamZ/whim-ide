const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const dbFile = 'C:/Users/Vendex/.codex/memories_1.sqlite';
console.log('Searching memories_1.sqlite stage1_outputs table...');

try {
    const db = new DatabaseSync(dbFile);
    const info = db.prepare(`PRAGMA table_info(stage1_outputs)`).all();
    console.log('Columns:', info.map(c => c.name));
    
    // Select text columns
    const textCols = info.filter(c => c.type === 'TEXT' || c.type === '').map(c => c.name);
    
    for (const col of textCols) {
        const query = `SELECT ${col} FROM stage1_outputs WHERE ${col} LIKE '%pub struct BackendState%'`;
        const rows = db.prepare(query).all();
        if (rows.length > 0) {
            console.log(`FOUND MATCH in column ${col}! Count: ${rows.length}`);
            for (const row of rows) {
                const val = row[col];
                if (val && val.includes('pub async fn select_workspace') && val.length > 100000) {
                    console.log('EXTRACTED successfully from memories SQLite, length:', val.length);
                    fs.writeFileSync('src-tauri/src/backend.rs', val, 'utf8');
                    process.exit(0);
                } else {
                    console.log('Value length:', val ? val.length : 0);
                    // Print context
                    console.log(val.slice(0, 1000));
                }
            }
        }
    }
} catch (e) {
    console.error('Error:', e.message);
}
console.log('Search in memories_1.sqlite completed.');

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const dbFile = 'C:/Users/Vendex/.codex/state_5.sqlite';
console.log('Searching state_5.sqlite tables...');

try {
    const db = new DatabaseSync(dbFile);
    const tables = ['agent_jobs', 'agent_job_items'];
    
    for (const tableName of tables) {
        const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
        console.log(`Columns of ${tableName}:`, info.map(c => c.name));
        const textCols = info.filter(c => c.type === 'TEXT' || c.type === '').map(c => c.name);
        
        for (const col of textCols) {
            const query = `SELECT ${col} FROM ${tableName} WHERE ${col} LIKE '%pub struct BackendState%'`;
            const rows = db.prepare(query).all();
            if (rows.length > 0) {
                console.log(`FOUND MATCH in table ${tableName}, column ${col}! Count: ${rows.length}`);
                for (const row of rows) {
                    const val = row[col];
                    if (val && val.includes('pub async fn select_workspace') && val.length > 100000) {
                        console.log('EXTRACTED successfully from state SQLite, length:', val.length);
                        fs.writeFileSync('src-tauri/src/backend.rs', val, 'utf8');
                        process.exit(0);
                    } else {
                        console.log('Value length:', val ? val.length : 0);
                    }
                }
            }
        }
    }
} catch (e) {
    console.error('Error:', e.message);
}
console.log('Search in state_5.sqlite completed.');

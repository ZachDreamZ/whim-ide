const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dbFiles = [
    'C:/Users/Vendex/.codex/logs_2.sqlite',
    'C:/Users/Vendex/.codex/memories_1.sqlite',
    'C:/Users/Vendex/.codex/goals_1.sqlite',
    'C:/Users/Vendex/.codex/state_5.sqlite',
];

console.log('Searching inside SQLite databases...');

for (const dbFile of dbFiles) {
    if (!fs.existsSync(dbFile)) {
        console.log('Not found:', dbFile);
        continue;
    }
    console.log('Reading database:', dbFile);
    try {
        const db = new DatabaseSync(dbFile);
        
        // Find tables
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log('Tables:', tables.map(t => t.name));
        
        for (const table of tables) {
            const tableName = table.name;
            // Let's get the columns of this table
            try {
                const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
                const textCols = info.filter(c => c.type === 'TEXT' || c.type === '').map(c => c.name);
                
                if (textCols.length === 0) continue;
                
                // Construct a query to search text columns for 'pub struct BackendState'
                for (const col of textCols) {
                    try {
                        const query = `SELECT ${col} FROM ${tableName} WHERE ${col} LIKE '%pub struct BackendState%'`;
                        const rows = db.prepare(query).all();
                        if (rows.length > 0) {
                            console.log(`FOUND MATCH in table ${tableName}, column ${col}! Count: ${rows.length}`);
                            // Print/Save the content
                            for (const row of rows) {
                                const val = row[col];
                                if (val && val.includes('pub async fn select_workspace') && val.length > 100000) {
                                    console.log('EXTRACTED successfully from sqlite, length:', val.length);
                                    fs.writeFileSync('src-tauri/src/backend.rs', val, 'utf8');
                                    process.exit(0);
                                } else {
                                    console.log('Value length:', val ? val.length : 0);
                                }
                            }
                        }
                    } catch (e) {
                        // Ignore
                    }
                }
            } catch (e) {
                // Ignore
            }
        }
    } catch (e) {
        console.error('Error reading:', dbFile, e.message);
    }
}
console.log('No matches found in SQLite databases.');

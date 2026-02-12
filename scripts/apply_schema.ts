import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

async function apply() {
    const dbPath = 'C:\\Users\\pbh04\\.cynapx\\714b0ead156b1e027c9d5a6b8ed0cfc1.db';
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    
    console.log(`Applying schema to: ${dbPath}`);
    const db = new Database(dbPath);
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    db.exec(schema);
    console.log("Schema applied successfully.");
    db.close();
}

apply().catch(console.error);

import Database from 'better-sqlite3';

async function debugDB() {
    const dbPath = 'C:\\Users\\pbh04\\.cynapx\\714b0ead156b1e027c9d5a6b8ed0cfc1.db';
    const db = new Database(dbPath);

    console.log("=== Last Updated Commits in DB ===");
    const rows = db.prepare(`
        SELECT qualified_name, last_updated_commit, checksum 
        FROM nodes 
        WHERE symbol_type = 'file' 
        LIMIT 5
    `).all();

    console.log(JSON.stringify(rows, null, 2));
    db.close();
}

debugDB().catch(console.error);

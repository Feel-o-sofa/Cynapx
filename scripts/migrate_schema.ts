import Database from 'better-sqlite3';

async function migrate() {
    const dbPath = 'C:\\Users\\pbh04\\.cynapx\\714b0ead156b1e027c9d5a6b8ed0cfc1.db';
    const db = new Database(dbPath);
    
    console.log("Running migration...");
    try {
        db.exec('ALTER TABLE nodes ADD COLUMN cluster_id INTEGER');
        console.log("Column cluster_id added to nodes.");
    } catch (e: any) {
        if (e.message.includes('duplicate column name')) {
            console.log("Column cluster_id already exists.");
        } else {
            throw e;
        }
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS logical_clusters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            cluster_type TEXT,
            avg_complexity REAL,
            central_symbol_qname TEXT
        )
    `);
    console.log("Table logical_clusters created.");

    db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_cluster_id ON nodes (cluster_id)');
    console.log("Index on cluster_id created.");

    db.close();
}

migrate().catch(console.error);

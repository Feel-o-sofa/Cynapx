import Database from 'better-sqlite3';

async function summary() {
    const dbPath = 'C:\\Users\\pbh04\\.cynapx\\714b0ead156b1e027c9d5a6b8ed0cfc1.db';
    const db = new Database(dbPath);

    const nodeCount = (db.prepare("SELECT COUNT(*) as count FROM nodes").get() as any).count;
    const edgeCount = (db.prepare("SELECT COUNT(*) as count FROM edges").get() as any).count;
    const clusterCount = (db.prepare("SELECT COUNT(*) as count FROM logical_clusters").get() as any).count;
    const fileCount = (db.prepare("SELECT COUNT(DISTINCT file_path) as count FROM nodes").get() as any).count;

    console.log(JSON.stringify({
        nodes: nodeCount,
        edges: edgeCount,
        clusters: clusterCount,
        files: fileCount,
        timestamp: new Date().toISOString()
    }, null, 2));

    db.close();
}

summary().catch(console.error);

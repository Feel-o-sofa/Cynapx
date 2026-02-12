import Database from 'better-sqlite3';

async function getEvidence() {
    const dbPath = 'C:\\Users\\pbh04\\.cynapx\\714b0ead156b1e027c9d5a6b8ed0cfc1.db';
    const db = new Database(dbPath);

    // 1. Get core cluster information
    const cluster = db.prepare(`
        SELECT * FROM logical_clusters 
        WHERE cluster_type = 'core' 
        ORDER BY avg_complexity DESC 
        LIMIT 1
    `).get() as any;

    if (!cluster) {
        console.log("No core cluster found.");
        return;
    }

    console.log("=== [Evidence 1] Cluster Metadata ===");
    console.log(JSON.stringify(cluster, null, 2));

    // 2. Inspect metrics of symbols inside that cluster
    const symbols = db.prepare(`
        SELECT qualified_name, symbol_type, cyclomatic, fan_in, fan_out 
        FROM nodes 
        WHERE cluster_id = ? 
        ORDER BY fan_out DESC 
        LIMIT 3
    `).all(cluster.id) as any[];

    console.log("\n=== [Evidence 2] Symbol Metrics inside Cluster ===");
    symbols.forEach(s => {
        console.log(`- Symbol: ${s.qualified_name.split(/[#.\/]/).pop()}`);
        console.log(`  * Complexity: ${s.cyclomatic}`);
        console.log(`  * Fan-out: ${s.fan_out}`);
        console.log(`  * Fan-in: ${s.fan_in}`);
    });

    db.close();
}

getEvidence().catch(console.error);

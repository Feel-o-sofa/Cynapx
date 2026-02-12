import Database from 'better-sqlite3';

async function summarize() {
    const dbPath = 'C:\\Users\\pbh04\\.cynapx\\714b0ead156b1e027c9d5a6b8ed0cfc1.db';
    const db = new Database(dbPath);

    console.log("=== Cynapx Semantic Architecture Map ===");
    
    const clusters = db.prepare(`
        SELECT c.*, (SELECT COUNT(*) FROM nodes WHERE cluster_id = c.id) as node_count 
        FROM logical_clusters c 
        ORDER BY avg_complexity DESC 
        LIMIT 5
    `).all() as any[];

    clusters.forEach((c, i) => {
        const typeIcon = c.cluster_type === 'core' ? '🧠' : (c.cluster_type === 'utility' ? '🛠️' : '📦');
        console.log(`${i+1}. ${typeIcon} [${c.cluster_type.toUpperCase()}] ${c.name}`);
        console.log(`   - 핵심 기능: ${c.central_symbol_qname.split(/[#.\/]/).pop()}`);
        console.log(`   - 복잡도 점수: ${c.avg_complexity.toFixed(2)}`);
        console.log(`   - 포함된 코드 수: ${c.node_count}개`);
        console.log("");
    });

    db.close();
}

summarize().catch(console.error);

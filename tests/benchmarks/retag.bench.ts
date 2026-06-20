/**
 * Benchmark: UpdatePipeline.reTagAllNodes() — Phase 12-7 (A-4).
 *
 * Builds a synthetic graph (mostly standalone nodes plus a few inheritance
 * chains) and measures a full retag pass. The dirty-set worklist only
 * reprocesses nodes on propagation edges, so the cost should scale with the
 * affected subgraph (n + e) rather than passes × all nodes × per-node edge
 * queries.
 */
import { bench, describe } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { NodeRepository } from '../../src/db/node-repository';
import { EdgeRepository } from '../../src/db/edge-repository';
import { UpdatePipeline } from '../../src/indexer/update-pipeline';

function buildFixture(nodeCount: number, chainCount: number, chainLength: number) {
    const db = new Database(':memory:');
    const fullSchema = fs.readFileSync(path.resolve(__dirname, '../../schema/schema.sql'), 'utf8');
    db.exec(fullSchema.split(';').filter(stmt => !stmt.includes('vec0')).join(';'));

    const nodeRepo = new NodeRepository(db);
    const edgeRepo = new EdgeRepository(db);

    const ids: number[] = [];
    for (let i = 0; i < nodeCount; i++) {
        ids.push(nodeRepo.createNode({
            qualified_name: `src/misc/file${i}.ts#Symbol${i}Service`,
            symbol_type: 'class',
            language: 'typescript',
            file_path: `src/misc/file${i}.ts`,
            start_line: 1,
            end_line: 10,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: 'bench',
            version: 1,
            fan_in: 0,
            fan_out: 0,
        } as any));
    }

    // A few inheritance chains over the first chainCount * chainLength nodes.
    for (let c = 0; c < chainCount; c++) {
        for (let i = 1; i < chainLength; i++) {
            const child = ids[c * chainLength + i];
            const parent = ids[c * chainLength + i - 1];
            edgeRepo.createEdge({ from_id: child, to_id: parent, edge_type: 'inherits', dynamic: false });
        }
    }

    const pipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, {} as any);
    return { pipeline };
}

const SMALL = buildFixture(200, 5, 4);
const LARGE = buildFixture(2000, 20, 10);

describe('UpdatePipeline.reTagAllNodes (dirty-set worklist)', () => {
    bench('full retag — 200 nodes / 5 inheritance chains', async () => {
        await SMALL.pipeline.reTagAllNodes();
    });

    bench('full retag — 2000 nodes / 20 inheritance chains (depth 10)', async () => {
        await LARGE.pipeline.reTagAllNodes();
    });
});

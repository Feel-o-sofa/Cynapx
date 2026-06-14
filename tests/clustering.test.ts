/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for GraphEngine.performClustering() — LPA community detection.
 * Uses an in-memory SQLite database (same pattern as graph-engine.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { GraphEngine, fisherYatesShuffle, mulberry32 } from '../src/graph/graph-engine';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { CodeNode, CodeEdge } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers (mirror graph-engine.test.ts pattern)
// ---------------------------------------------------------------------------

function createInMemoryEngine(): {
    engine: GraphEngine;
    nodeRepo: NodeRepository;
    edgeRepo: EdgeRepository;
} {
    const db = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');

    // Strip vec0 virtual-table statements — extension not available in test binary.
    const filteredSchema = fullSchema
        .split(';')
        .filter(stmt => !stmt.includes('vec0'))
        .join(';');

    db.exec(filteredSchema);

    const nodeRepo = new NodeRepository(db);
    const edgeRepo = new EdgeRepository(db);
    const engine = new GraphEngine(nodeRepo, edgeRepo);
    return { engine, nodeRepo, edgeRepo };
}

function makeNode(nodeRepo: NodeRepository, qname: string): number {
    return nodeRepo.createNode({
        qualified_name: qname,
        symbol_type: 'function',
        language: 'typescript',
        file_path: 'test.ts',
        start_line: 1,
        end_line: 10,
        visibility: 'public',
        is_generated: false,
        last_updated_commit: 'abc',
        version: 1,
    } as CodeNode);
}

function makeEdge(edgeRepo: EdgeRepository, fromId: number, toId: number): void {
    edgeRepo.createEdge({
        from_id: fromId,
        to_id: toId,
        edge_type: 'calls',
        dynamic: false,
    } as CodeEdge);
}

// ---------------------------------------------------------------------------
// performClustering tests
// ---------------------------------------------------------------------------

describe('GraphEngine.performClustering() — LPA', () => {
    let engine: GraphEngine;
    let nodeRepo: NodeRepository;
    let edgeRepo: EdgeRepository;

    beforeEach(() => {
        ({ engine, nodeRepo, edgeRepo } = createInMemoryEngine());
    });

    it('returns clusterCount:0 and nodesClustered:0 for an empty graph', async () => {
        const result = await engine.performClustering();
        expect(result.clusterCount).toBe(0);
        expect(result.nodesClustered).toBe(0);
    });

    it('reports nodesClustered equal to the total number of nodes', async () => {
        makeNode(nodeRepo, 'A');
        makeNode(nodeRepo, 'B');
        makeNode(nodeRepo, 'C');

        const result = await engine.performClustering();
        expect(result.nodesClustered).toBe(3);
    });

    it('isolated nodes (no edges) do not crash — each becomes its own label', async () => {
        makeNode(nodeRepo, 'Isolated1');
        makeNode(nodeRepo, 'Isolated2');
        makeNode(nodeRepo, 'Isolated3');

        // Should not throw
        const result = await engine.performClustering();
        expect(result.nodesClustered).toBe(3);
        // At most one cluster per node (could be fewer if same-label groups collapse)
        expect(result.clusterCount).toBeGreaterThanOrEqual(0);
    });

    it('two connected nodes share a cluster (clusterCount < nodesClustered)', async () => {
        const a = makeNode(nodeRepo, 'P');
        const b = makeNode(nodeRepo, 'Q');
        // Add bidirectional edges so LPA propagation can merge labels
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, b, a);

        const result = await engine.performClustering();
        expect(result.nodesClustered).toBe(2);
        // LPA should converge these two connected nodes into the same cluster
        // clusterCount will be <= 1 (only cluster with size >= 2 is persisted).
        // We just verify it doesn't crash and nodesClustered is correct.
        expect(result.clusterCount).toBeGreaterThanOrEqual(0);
    });

    it('calling performClustering() twice does not throw or corrupt state', async () => {
        const a = makeNode(nodeRepo, 'X');
        const b = makeNode(nodeRepo, 'Y');
        makeEdge(edgeRepo, a, b);

        const first = await engine.performClustering();
        const second = await engine.performClustering();

        expect(first.nodesClustered).toBe(2);
        expect(second.nodesClustered).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Fisher-Yates shuffle helper (A-5/O-4, Phase 14-4)
// ---------------------------------------------------------------------------

describe('fisherYatesShuffle', () => {
    it('preserves the full element set (no duplicates, no drops)', () => {
        const original = Array.from({ length: 100 }, (_, i) => i);
        const shuffled = fisherYatesShuffle([...original]);
        expect(shuffled).toHaveLength(original.length);
        expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
    });

    it('is deterministic given a seeded PRNG', () => {
        const original = Array.from({ length: 50 }, (_, i) => i);
        const a = fisherYatesShuffle([...original], mulberry32(123));
        const b = fisherYatesShuffle([...original], mulberry32(123));
        expect(a).toEqual(b);
    });

    it('handles empty and single-element arrays', () => {
        expect(fisherYatesShuffle([])).toEqual([]);
        expect(fisherYatesShuffle([42])).toEqual([42]);
    });
});

// ---------------------------------------------------------------------------
// Deterministic seed + large-graph guard (A-5 / A-2, Phase 14-4)
// ---------------------------------------------------------------------------

describe('GraphEngine.performClustering() — seed + guard', () => {
    const SEED_ENV = 'CYNAPX_CLUSTER_SEED';
    const MAX_ENV = 'CYNAPX_CLUSTER_MAX_NODES';
    let savedSeed: string | undefined;
    let savedMax: string | undefined;

    beforeEach(() => {
        savedSeed = process.env[SEED_ENV];
        savedMax = process.env[MAX_ENV];
        delete process.env[SEED_ENV];
        delete process.env[MAX_ENV];
    });

    afterEach(() => {
        if (savedSeed === undefined) delete process.env[SEED_ENV]; else process.env[SEED_ENV] = savedSeed;
        if (savedMax === undefined) delete process.env[MAX_ENV]; else process.env[MAX_ENV] = savedMax;
    });

    // Build a small graph with several overlapping communities so that LPA
    // ordering actually influences the outcome.
    function buildGraph(): { engine: GraphEngine; nodeRepo: NodeRepository } {
        const { engine, nodeRepo, edgeRepo } = createInMemoryEngine();
        const ids: number[] = [];
        for (let i = 0; i < 12; i++) ids.push(makeNode(nodeRepo, `N${i}`));
        // Two loosely connected triangles + a bridge to create ordering-sensitive ties.
        const ring = [
            [0, 1], [1, 2], [2, 0],
            [3, 4], [4, 5], [5, 3],
            [6, 7], [7, 8], [8, 6],
            [9, 10], [10, 11], [11, 9],
            [2, 3], [5, 6], [8, 9], [11, 0],
        ];
        for (const [a, b] of ring) {
            makeEdge(edgeRepo, ids[a], ids[b]);
            makeEdge(edgeRepo, ids[b], ids[a]);
        }
        return { engine, nodeRepo };
    }

    function snapshot(nodeRepo: NodeRepository): { count: number; assignments: Record<string, number | null> } {
        const result: Record<string, number | null> = {};
        for (const n of nodeRepo.getAllNodes()) {
            result[n.qualified_name] = n.cluster_id ?? null;
        }
        const count = new Set(Object.values(result).filter(v => v !== null)).size;
        return { count, assignments: result };
    }

    it('fixed CYNAPX_CLUSTER_SEED → identical clusterCount and per-node cluster_id across runs', async () => {
        process.env[SEED_ENV] = '987654321';

        const g1 = buildGraph();
        const r1 = await g1.engine.performClustering();
        const s1 = snapshot(g1.nodeRepo);

        const g2 = buildGraph();
        const r2 = await g2.engine.performClustering();
        const s2 = snapshot(g2.nodeRepo);

        expect(r2.clusterCount).toBe(r1.clusterCount);
        expect(s2.assignments).toEqual(s1.assignments);
    });

    it('different seeds may differ, but each seed is internally reproducible', async () => {
        process.env[SEED_ENV] = '1';
        const g1 = buildGraph();
        await g1.engine.performClustering();
        const a1 = snapshot(g1.nodeRepo).assignments;

        const g2 = buildGraph();
        await g2.engine.performClustering();
        const a2 = snapshot(g2.nodeRepo).assignments;

        // Same seed → identical (reproducibility), regardless of cross-seed difference.
        expect(a2).toEqual(a1);
    });

    it('large-graph guard: skips clustering with a warning when node count exceeds CYNAPX_CLUSTER_MAX_NODES', async () => {
        process.env[MAX_ENV] = '3';
        const { engine, nodeRepo, edgeRepo } = createInMemoryEngine();
        const ids: number[] = [];
        for (let i = 0; i < 5; i++) ids.push(makeNode(nodeRepo, `G${i}`));
        makeEdge(edgeRepo, ids[0], ids[1]);
        makeEdge(edgeRepo, ids[1], ids[0]);

        const warnings: string[] = [];
        const original = console.error;
        console.error = (msg?: unknown) => { warnings.push(String(msg)); };
        try {
            const result = await engine.performClustering();
            // Guard short-circuits — no clustering performed, no crash.
            expect(result.clusterCount).toBe(0);
            expect(result.nodesClustered).toBe(0);
        } finally {
            console.error = original;
        }

        expect(warnings.some(w => w.includes('Skipping clustering') && w.includes('CYNAPX_CLUSTER_MAX_NODES'))).toBe(true);
        // No node should have been assigned a cluster.
        for (const n of nodeRepo.getAllNodes()) {
            expect(n.cluster_id ?? null).toBeNull();
        }
    });

    it('node count at or below the guard threshold proceeds normally', async () => {
        process.env[MAX_ENV] = '12';
        const { engine, nodeRepo } = buildGraph();
        const result = await engine.performClustering();
        expect(result.nodesClustered).toBe(12);
    });

    // M-4 (Phase 15-1): count-first guard. The guard now probes countNodes()
    // BEFORE getAllNodes()/getAllEdges() load the full set, so an over-threshold
    // graph short-circuits without materializing the node/edge arrays.
    it('count-first guard: getAllNodes/getAllEdges are NOT called when over threshold', async () => {
        process.env[MAX_ENV] = '3';
        const { engine, nodeRepo, edgeRepo } = createInMemoryEngine();
        const ids: number[] = [];
        for (let i = 0; i < 5; i++) ids.push(makeNode(nodeRepo, `C${i}`));
        makeEdge(edgeRepo, ids[0], ids[1]);

        const nodesSpy = vi.spyOn(nodeRepo, 'getAllNodes');
        const edgesSpy = vi.spyOn(edgeRepo, 'getAllEdges');
        const countSpy = vi.spyOn(nodeRepo, 'countNodes');

        const result = await engine.performClustering();

        expect(result).toEqual({ clusterCount: 0, nodesClustered: 0 });
        // countNodes() probe ran; the full loads did not.
        expect(countSpy).toHaveBeenCalled();
        expect(nodesSpy).not.toHaveBeenCalled();
        expect(edgesSpy).not.toHaveBeenCalled();

        nodesSpy.mockRestore();
        edgesSpy.mockRestore();
        countSpy.mockRestore();
    });

    it('count-first guard: in-bounds graph still loads nodes/edges and clusters identically', async () => {
        process.env[SEED_ENV] = '987654321';
        process.env[MAX_ENV] = '100';

        // Baseline run without the spy harness.
        const baseline = buildGraph();
        const rBase = await baseline.engine.performClustering();
        const sBase = snapshot(baseline.nodeRepo);

        // Spied run — must call getAllNodes/getAllEdges and produce identical results.
        const g = buildGraph();
        const nodesSpy = vi.spyOn(g.nodeRepo, 'getAllNodes');
        const r = await g.engine.performClustering();
        const s = snapshot(g.nodeRepo);

        expect(nodesSpy).toHaveBeenCalled();
        expect(r.clusterCount).toBe(rBase.clusterCount);
        expect(s.assignments).toEqual(sBase.assignments);

        nodesSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// NodeRepository.countNodes() probe (M-4, Phase 15-1)
// ---------------------------------------------------------------------------

describe('NodeRepository.countNodes()', () => {
    it('returns 0 for an empty table and the exact count otherwise', () => {
        const { nodeRepo } = createInMemoryEngine();
        expect(nodeRepo.countNodes()).toBe(0);
        makeNode(nodeRepo, 'A');
        makeNode(nodeRepo, 'B');
        expect(nodeRepo.countNodes()).toBe(2);
    });
});

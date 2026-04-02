/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for GraphEngine BFS and DFS traversal.
 * Uses an in-memory SQLite database to avoid any filesystem side effects.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { GraphEngine } from '../src/graph/graph-engine';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { CodeNode, CodeEdge } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInMemoryEngine(): {
    engine: GraphEngine;
    nodeRepo: NodeRepository;
    edgeRepo: EdgeRepository;
} {
    const db = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');

    // The full schema includes a `vec0` virtual table (sqlite-vec extension) used
    // for semantic-search embeddings.  That extension is not available in the plain
    // better-sqlite3 binary, so we strip any statement that references it before
    // loading the schema into the in-memory database.
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
// BFS traversal tests
// ---------------------------------------------------------------------------

describe('GraphEngine BFS traversal', () => {
    let engine: GraphEngine;
    let nodeRepo: NodeRepository;
    let edgeRepo: EdgeRepository;

    beforeEach(() => {
        ({ engine, nodeRepo, edgeRepo } = createInMemoryEngine());
    });

    it('returns only the start node when no edges exist', () => {
        const id = makeNode(nodeRepo, 'A');
        const results = engine.traverse(id, 'BFS', { maxDepth: 3, useCache: false });
        expect(results).toHaveLength(1);
        expect(results[0].node.qualified_name).toBe('A');
        expect(results[0].distance).toBe(0);
    });

    it('traverses a linear chain A→B→C (outgoing)', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        const c = makeNode(nodeRepo, 'C');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, b, c);

        const results = engine.traverse(a, 'BFS', { maxDepth: 5, useCache: false });
        const names = results.map(r => r.node.qualified_name);
        expect(names).toContain('A');
        expect(names).toContain('B');
        expect(names).toContain('C');
        expect(results.find(r => r.node.qualified_name === 'B')!.distance).toBe(1);
        expect(results.find(r => r.node.qualified_name === 'C')!.distance).toBe(2);
    });

    it('respects maxDepth — nodes beyond the limit are excluded', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        const c = makeNode(nodeRepo, 'C');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, b, c);

        const results = engine.traverse(a, 'BFS', { maxDepth: 1, useCache: false });
        const names = results.map(r => r.node.qualified_name);
        expect(names).toContain('A');
        expect(names).toContain('B');
        expect(names).not.toContain('C');
    });

    it('does not revisit nodes in a graph with a direct cycle (A→B→A)', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, b, a); // cycle back

        const results = engine.traverse(a, 'BFS', { maxDepth: 10, useCache: false });
        // Should visit exactly A and B — no infinite loop or duplicates
        expect(results).toHaveLength(2);
        const names = results.map(r => r.node.qualified_name).sort();
        expect(names).toEqual(['A', 'B']);
    });

    it('traverses incoming direction — finds callers of B', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        makeEdge(edgeRepo, a, b); // A calls B

        // Traversing B in the incoming direction should find A
        const results = engine.traverse(b, 'BFS', {
            maxDepth: 5,
            direction: 'incoming',
            useCache: false,
        });
        const names = results.map(r => r.node.qualified_name);
        expect(names).toContain('B'); // start node always present
        expect(names).toContain('A'); // A is an incoming neighbour of B
    });

    it('path reconstruction is correct for A→B→C', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        const c = makeNode(nodeRepo, 'C');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, b, c);

        const results = engine.traverse(a, 'BFS', { maxDepth: 5, useCache: false });
        const cResult = results.find(r => r.node.qualified_name === 'C');
        expect(cResult).toBeDefined();
        // Path should be [A, B, C]
        expect(cResult!.path).toHaveLength(3);
        expect(cResult!.path[0].nodeId).toBe(a);
        expect(cResult!.path[1].nodeId).toBe(b);
        expect(cResult!.path[2].nodeId).toBe(c);
    });

    it('path for start node has length 1 with the start nodeId', () => {
        const a = makeNode(nodeRepo, 'A');
        const results = engine.traverse(a, 'BFS', { maxDepth: 3, useCache: false });
        expect(results[0].path).toHaveLength(1);
        expect(results[0].path[0].nodeId).toBe(a);
        expect(results[0].path[0].edge).toBeUndefined();
    });

    it('handles a diamond graph A→B, A→C, B→D, C→D without duplicating D', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        const c = makeNode(nodeRepo, 'C');
        const d = makeNode(nodeRepo, 'D');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, a, c);
        makeEdge(edgeRepo, b, d);
        makeEdge(edgeRepo, c, d);

        const results = engine.traverse(a, 'BFS', { maxDepth: 5, useCache: false });
        const names = results.map(r => r.node.qualified_name);
        expect(names).toContain('D');
        // D should appear only once
        expect(names.filter(n => n === 'D')).toHaveLength(1);
    });

    it('start node has distance 0 in a non-trivial graph', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        makeEdge(edgeRepo, a, b);

        const results = engine.traverse(a, 'BFS', { maxDepth: 5, useCache: false });
        const aResult = results.find(r => r.node.qualified_name === 'A');
        expect(aResult).toBeDefined();
        expect(aResult!.distance).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// DFS traversal tests
// ---------------------------------------------------------------------------

describe('GraphEngine DFS traversal', () => {
    let engine: GraphEngine;
    let nodeRepo: NodeRepository;
    let edgeRepo: EdgeRepository;

    beforeEach(() => {
        ({ engine, nodeRepo, edgeRepo } = createInMemoryEngine());
    });

    it('returns only the start node when no edges exist', () => {
        const id = makeNode(nodeRepo, 'X');
        const results = engine.traverse(id, 'DFS', { maxDepth: 5 });
        expect(results).toHaveLength(1);
        expect(results[0].node.qualified_name).toBe('X');
        expect(results[0].distance).toBe(0);
    });

    it('visits all nodes in a tree (DFS) — A→B, A→C, C→D', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        const c = makeNode(nodeRepo, 'C');
        const d = makeNode(nodeRepo, 'D');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, a, c);
        makeEdge(edgeRepo, c, d);

        const results = engine.traverse(a, 'DFS', { maxDepth: 10 });
        const names = results.map(r => r.node.qualified_name).sort();
        expect(names).toEqual(['A', 'B', 'C', 'D']);
    });

    it('does not revisit nodes in a cycle (A→B→A)', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, b, a); // cycle

        const results = engine.traverse(a, 'DFS', { maxDepth: 100 });
        // Must terminate and return exactly A and B
        expect(results).toHaveLength(2);
        const names = results.map(r => r.node.qualified_name).sort();
        expect(names).toEqual(['A', 'B']);
    });

    it('respects maxDepth — C is beyond depth 1', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        const c = makeNode(nodeRepo, 'C');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, b, c);

        const results = engine.traverse(a, 'DFS', { maxDepth: 1 });
        const names = results.map(r => r.node.qualified_name);
        expect(names).toContain('A');
        expect(names).toContain('B');
        expect(names).not.toContain('C');
    });

    it('traverses a linear chain A→B→C and records correct distances', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        const c = makeNode(nodeRepo, 'C');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, b, c);

        const results = engine.traverse(a, 'DFS', { maxDepth: 5 });
        expect(results.find(r => r.node.qualified_name === 'A')!.distance).toBe(0);
        expect(results.find(r => r.node.qualified_name === 'B')!.distance).toBe(1);
        expect(results.find(r => r.node.qualified_name === 'C')!.distance).toBe(2);
    });

    it('traverses incoming direction (DFS) — finds callers of B', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        makeEdge(edgeRepo, a, b); // A calls B

        const results = engine.traverse(b, 'DFS', {
            maxDepth: 5,
            direction: 'incoming',
        });
        const names = results.map(r => r.node.qualified_name);
        expect(names).toContain('B');
        expect(names).toContain('A');
    });

    it('path for start node has length 1 with no edge', () => {
        const a = makeNode(nodeRepo, 'A');
        const results = engine.traverse(a, 'DFS', { maxDepth: 5 });
        expect(results[0].path).toHaveLength(1);
        expect(results[0].path[0].nodeId).toBe(a);
        expect(results[0].path[0].edge).toBeUndefined();
    });

    it('does not produce duplicate nodes in a diamond graph', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        const c = makeNode(nodeRepo, 'C');
        const d = makeNode(nodeRepo, 'D');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, a, c);
        makeEdge(edgeRepo, b, d);
        makeEdge(edgeRepo, c, d);

        const results = engine.traverse(a, 'DFS', { maxDepth: 5 });
        const names = results.map(r => r.node.qualified_name);
        // D reachable via two paths but should appear only once
        expect(names.filter(n => n === 'D')).toHaveLength(1);
        expect(results).toHaveLength(4); // A, B, C, D
    });
});

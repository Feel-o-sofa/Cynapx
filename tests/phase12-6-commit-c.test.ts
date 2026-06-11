/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 12-6 commit C (graph/schema cleanup):
 * - O-7: GraphEngine DFS maxDepth boundary (entry.depth > maxDepth)
 * - O-8: single-node (non-file) clusters are not persisted
 * - O-9: node_embeddings cleanup on node deletion
 * - O-6: AuditLogger size-based rotation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GraphEngine } from '../src/graph/graph-engine';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { CodeNode, CodeEdge } from '../src/types';
import { AuditLogger } from '../src/utils/audit-logger';

function createInMemoryEngine(): { engine: GraphEngine; nodeRepo: NodeRepository; edgeRepo: EdgeRepository; db: Database.Database } {
    const db = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');
    const filteredSchema = fullSchema
        .split(';')
        .filter(stmt => !stmt.includes('vec0'))
        .join(';');
    db.exec(filteredSchema);

    const nodeRepo = new NodeRepository(db);
    const edgeRepo = new EdgeRepository(db);
    const engine = new GraphEngine(nodeRepo, edgeRepo);
    return { engine, nodeRepo, edgeRepo, db };
}

function makeNode(nodeRepo: NodeRepository, qname: string, overrides: Partial<CodeNode> = {}): number {
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
        ...overrides,
    } as CodeNode);
}

function makeEdge(edgeRepo: EdgeRepository, fromId: number, toId: number): void {
    edgeRepo.createEdge({ from_id: fromId, to_id: toId, edge_type: 'calls', dynamic: false } as CodeEdge);
}

describe('O-7: DFS maxDepth boundary', () => {
    let engine: GraphEngine;
    let nodeRepo: NodeRepository;
    let edgeRepo: EdgeRepository;

    beforeEach(() => {
        ({ engine, nodeRepo, edgeRepo } = createInMemoryEngine());
    });

    it('includes the node exactly at maxDepth but not beyond', () => {
        const a = makeNode(nodeRepo, 'A');
        const b = makeNode(nodeRepo, 'B');
        const c = makeNode(nodeRepo, 'C');
        const d = makeNode(nodeRepo, 'D');
        makeEdge(edgeRepo, a, b);
        makeEdge(edgeRepo, b, c);
        makeEdge(edgeRepo, c, d);

        const results = engine.traverse(a, 'DFS', { maxDepth: 2 });
        const names = results.map(r => r.node.qualified_name);

        expect(names).toEqual(expect.arrayContaining(['A', 'B', 'C']));
        expect(names).not.toContain('D');

        const cResult = results.find(r => r.node.qualified_name === 'C')!;
        expect(cResult.distance).toBe(2);
    });
});

describe('O-8: single-node clusters are not persisted', () => {
    let engine: GraphEngine;
    let nodeRepo: NodeRepository;
    let db: Database.Database;

    beforeEach(() => {
        ({ engine, nodeRepo, db } = createInMemoryEngine());
    });

    it('does not create a logical_cluster for an isolated non-file node', async () => {
        // An isolated node with no edges forms its own singleton cluster.
        makeNode(nodeRepo, 'a.ts#isolated', { symbol_type: 'function' });

        await engine.performClustering();

        const clusters = db.prepare('SELECT * FROM logical_clusters').all();
        expect(clusters).toHaveLength(0);
    });

    it('persists a singleton cluster for a file-type node', async () => {
        makeNode(nodeRepo, 'a.ts', { symbol_type: 'file' });

        await engine.performClustering();

        const clusters = db.prepare('SELECT * FROM logical_clusters').all();
        expect(clusters).toHaveLength(1);
    });
});

describe('O-9: node_embeddings cleanup on node deletion', () => {
    let nodeRepo: NodeRepository;
    let db: Database.Database;

    beforeEach(() => {
        ({ nodeRepo, db } = createInMemoryEngine());
    });

    it('does not throw when node_embeddings table does not exist (vec0 stripped)', () => {
        const id = makeNode(nodeRepo, 'a.ts#Foo');
        expect(() => nodeRepo.deleteNodesByFilePath('test.ts')).not.toThrow();
        expect(nodeRepo.getNodeById(id)).toBeNull();
    });

    it('removes node_embeddings rows for deleted nodes when the table exists', () => {
        // Simulate node_embeddings as a plain table (vec0 unavailable in unit tests).
        db.exec('CREATE TABLE node_embeddings (rowid INTEGER PRIMARY KEY, embedding BLOB)');

        const id1 = makeNode(nodeRepo, 'a.ts#Foo');
        const id2 = makeNode(nodeRepo, 'a.ts#Bar');
        db.prepare('INSERT INTO node_embeddings (rowid, embedding) VALUES (?, ?)').run(id1, Buffer.from([1, 2, 3]));
        db.prepare('INSERT INTO node_embeddings (rowid, embedding) VALUES (?, ?)').run(id2, Buffer.from([4, 5, 6]));

        nodeRepo.deleteNodesByFilePath('test.ts');

        const remaining = db.prepare('SELECT * FROM node_embeddings').all();
        expect(remaining).toHaveLength(0);
    });

    it('purgeEmbeddings is a no-op for an empty id list', () => {
        expect(() => nodeRepo.purgeEmbeddings([])).not.toThrow();
    });
});

describe('O-6: AuditLogger size-based rotation', () => {
    let tmpDir: string;
    let logPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-audit-'));
        logPath = path.join(tmpDir, 'audit.log');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('rotates the log to .1 when it exceeds the size threshold', () => {
        // Pre-create a log file larger than the 100MB threshold (sparse file).
        const fd = fs.openSync(logPath, 'w');
        fs.ftruncateSync(fd, 101 * 1024 * 1024);
        fs.closeSync(fd);

        const logger = new AuditLogger(logPath);
        logger.log('index_start', { project: 'test' });

        expect(fs.existsSync(`${logPath}.1`)).toBe(true);
        const newContent = fs.readFileSync(logPath, 'utf8').trim();
        const entry = JSON.parse(newContent);
        expect(entry.event).toBe('index_start');

        const rotatedStat = fs.statSync(`${logPath}.1`);
        expect(rotatedStat.size).toBeGreaterThanOrEqual(101 * 1024 * 1024);
    });

    it('does not rotate when under the size threshold', () => {
        const logger = new AuditLogger(logPath);
        logger.log('index_start', { project: 'test' });
        logger.log('index_complete', { project: 'test' });

        expect(fs.existsSync(`${logPath}.1`)).toBe(false);
        const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
    });
});

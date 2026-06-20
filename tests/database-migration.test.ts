/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Tests for DatabaseManager schema migrations.
 * Phase 12-5 (A-2): migration 1 -> 2 creates node_tags and backfills it
 * from the existing nodes.tags JSON column.
 */
import { describe, it, expect, vi } from 'vitest';
import { DatabaseManager } from '../src/db/database';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import type { CodeNode } from '../src/types';

function makeNode(overrides: Partial<CodeNode> & Pick<CodeNode, 'qualified_name'>): CodeNode {
    return {
        symbol_type: 'function',
        language: 'typescript',
        file_path: 'a.ts',
        start_line: 1,
        end_line: 5,
        visibility: 'public',
        is_generated: false,
        last_updated_commit: 'c1',
        version: 1,
        ...overrides,
    } as CodeNode;
}

describe('DatabaseManager.runMigrations()', () => {
    it('initializes a fresh database at the current SCHEMA_VERSION', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();

        const version = db.pragma('user_version', { simple: true }) as number;
        expect(version).toBe(DatabaseManager.SCHEMA_VERSION);
        expect(DatabaseManager.SCHEMA_VERSION).toBeGreaterThanOrEqual(2);

        manager.dispose();
    });

    // CVE-2025-7709 (Phase 13-7): better-sqlite3 was upgraded to 12.x, which
    // bundles SQLite >= 3.53.1. The vulnerable FTS5 heap OOB write was fixed in
    // SQLite 3.50.3. This guards against an accidental downgrade.
    it('bundles a SQLite version >= 3.50.3 (CVE-2025-7709 regression guard)', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        const version = (db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v;
        const [maj, min, patch] = version.split('.').map(Number);
        const asNum = maj * 10000 + min * 100 + patch;
        expect(asNum).toBeGreaterThanOrEqual(3 * 10000 + 50 * 100 + 3);
        manager.dispose();
    });

    it('creates the node_tags table and idx_node_tags_tag index', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();

        const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'node_tags'").get();
        expect(table).toBeDefined();

        const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_node_tags_tag'").get();
        expect(index).toBeDefined();

        manager.dispose();
    });

    it('migration 1 -> 2 backfills node_tags from nodes.tags JSON', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();

        // Simulate a pre-migration database: drop node_tags and roll back user_version,
        // then insert a node with a JSON tags column as if written before A-2.
        db.exec('DROP TABLE node_tags');
        db.pragma('user_version = 1');

        db.prepare(`
            INSERT INTO nodes (
                qualified_name, symbol_type, language, file_path, start_line, end_line,
                visibility, is_generated, last_updated_commit, version, tags
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('a.ts#Foo.bar', 'method', 'typescript', 'a.ts', 1, 10, 'private', 0, 'abc', 1, JSON.stringify(['trait:entrypoint', 'trait:static']));

        manager.runMigrations();

        const version = db.pragma('user_version', { simple: true }) as number;
        expect(version).toBe(DatabaseManager.SCHEMA_VERSION);

        const node = db.prepare("SELECT id FROM nodes WHERE qualified_name = 'a.ts#Foo.bar'").get() as { id: number };
        const tags = db.prepare('SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag').all(node.id) as { tag: string }[];
        expect(tags.map(t => t.tag)).toEqual(['trait:entrypoint', 'trait:static']);

        manager.dispose();
    });

    it('A-1: re-indexing the same qualified_name preserves node id and cross-file edges', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        const nodeRepo = new NodeRepository(db);
        const edgeRepo = new EdgeRepository(db);

        // Target symbol (defined in target.ts) and a caller (in caller.ts) that
        // references it via a 'calls' edge.
        const targetId = nodeRepo.createNode(makeNode({
            qualified_name: 'target.ts#doWork', file_path: 'target.ts', tags: ['trait:internal'],
        }));
        const callerId = nodeRepo.createNode(makeNode({
            qualified_name: 'caller.ts#main', file_path: 'caller.ts',
        }));
        edgeRepo.createEdge({ from_id: callerId, to_id: targetId, edge_type: 'calls', dynamic: false } as any);

        // Re-index the target symbol (e.g. its file was edited) — same qname.
        const reindexedId = nodeRepo.createNode(makeNode({
            qualified_name: 'target.ts#doWork', file_path: 'target.ts', start_line: 10, end_line: 20, tags: ['trait:entrypoint'],
        }));

        // id must be preserved (INSERT OR REPLACE would have allocated a new one).
        expect(reindexedId).toBe(targetId);

        // The cross-file edge from caller.ts must still resolve to the target.
        const edges = edgeRepo.getOutgoingEdges(callerId);
        expect(edges).toHaveLength(1);
        expect(edges[0].to_id).toBe(targetId);

        // The UPDATE branch refreshed the row's columns.
        const updated = nodeRepo.getNodeById(targetId)!;
        expect(updated.start_line).toBe(10);

        // node_tags were refreshed to the new tag set (no stale trait:internal).
        const tags = db.prepare('SELECT tag FROM node_tags WHERE node_id = ?').all(targetId) as { tag: string }[];
        expect(tags.map(t => t.tag)).toEqual(['trait:entrypoint']);

        manager.dispose();
    });

    it('A-1: re-indexing does not leak orphan fts_symbols rows', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        const nodeRepo = new NodeRepository(db);

        const id = nodeRepo.createNode(makeNode({ qualified_name: 'x.ts#foo', file_path: 'x.ts' }));
        // Re-index the same symbol several times.
        for (let i = 0; i < 5; i++) {
            nodeRepo.createNode(makeNode({ qualified_name: 'x.ts#foo', file_path: 'x.ts', start_line: i + 1 }));
        }

        // recursive_triggers ON + nodes_au keeps fts_symbols 1:1 with nodes:
        // exactly one fts row, matching the single node id.
        const ftsRows = db.prepare("SELECT rowid FROM fts_symbols WHERE fts_symbols MATCH 'foo'").all() as { rowid: number }[];
        expect(ftsRows).toHaveLength(1);
        expect(ftsRows[0].rowid).toBe(id);

        const nodeCount = (db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as { c: number }).c;
        expect(nodeCount).toBe(1);

        manager.dispose();
    });

    it('A-1: recursive_triggers pragma is ON', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        expect(db.pragma('recursive_triggers', { simple: true })).toBe(1);
        manager.dispose();
    });

    it('M3: fires onMigration callbacks when a migration actually runs via the public method', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        const onMigrationCb = vi.fn();
        manager.onMigration(onMigrationCb);

        // Already at the latest version: no migration runs, no callback.
        manager.runMigrations();
        expect(onMigrationCb).not.toHaveBeenCalled();

        // Roll back to version 1 and re-run: the callback must fire once.
        db.exec('DROP TABLE node_tags');
        db.pragma('user_version = 1');
        manager.runMigrations();
        expect(onMigrationCb).toHaveBeenCalledTimes(1);

        manager.dispose();
    });
});

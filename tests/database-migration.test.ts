/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Tests for DatabaseManager schema migrations.
 * Phase 12-5 (A-2): migration 1 -> 2 creates node_tags and backfills it
 * from the existing nodes.tags JSON column.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseManager } from '../src/db/database';

describe('DatabaseManager.runMigrations()', () => {
    it('initializes a fresh database at the current SCHEMA_VERSION', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();

        const version = db.pragma('user_version', { simple: true }) as number;
        expect(version).toBe(DatabaseManager.SCHEMA_VERSION);
        expect(DatabaseManager.SCHEMA_VERSION).toBeGreaterThanOrEqual(2);

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
});

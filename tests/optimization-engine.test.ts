/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for OptimizationEngine.findDeadCode() / NodeRepository.findDeadCodeCandidates().
 * Phase 12-5 (A-2/A-3): tag-based filters now use the node_tags JOIN table
 * instead of `tags LIKE '%...%'` on the JSON column.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { GraphEngine } from '../src/graph/graph-engine';
import { OptimizationEngine } from '../src/graph/optimization-engine';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { CodeNode } from '../src/types';

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

function makeNode(nodeRepo: NodeRepository, overrides: Partial<CodeNode> & { qualified_name: string }): number {
    return nodeRepo.createNode({
        symbol_type: 'method',
        language: 'typescript',
        file_path: 'test.ts',
        start_line: 1,
        end_line: 10,
        visibility: 'private',
        is_generated: false,
        last_updated_commit: 'abc',
        version: 1,
        fan_in: 0,
        fan_out: 0,
        ...overrides,
    } as CodeNode);
}

describe('OptimizationEngine.findDeadCode() — A-2/A-3 node_tags JOIN', () => {
    let engine: GraphEngine;
    let nodeRepo: NodeRepository;
    let db: Database.Database;
    let optEngine: OptimizationEngine;

    beforeEach(() => {
        ({ engine, nodeRepo, db } = createInMemoryEngine());
        optEngine = new OptimizationEngine(engine);
    });

    it('classifies a private unused method as HIGH confidence dead code', async () => {
        makeNode(nodeRepo, { qualified_name: 'a.ts#Foo.bar', visibility: 'private' });

        const report = await optEngine.findDeadCode();
        expect(report.high.map(n => n.qualified_name)).toContain('a.ts#Foo.bar');
        expect(report.summary.highConfidenceDead).toBe(1);
    });

    it('excludes nodes tagged trait:entrypoint via node_tags', async () => {
        makeNode(nodeRepo, { qualified_name: 'a.ts#main', visibility: 'private', tags: ['trait:entrypoint'] });

        const report = await optEngine.findDeadCode();
        expect(report.high.map(n => n.qualified_name)).not.toContain('a.ts#main');
        expect(report.summary.highConfidenceDead).toBe(0);
    });

    it('excludes nodes tagged trait:abstract via node_tags', async () => {
        makeNode(nodeRepo, { qualified_name: 'a.ts#AbstractFoo.bar', visibility: 'private', tags: ['trait:abstract'] });

        const report = await optEngine.findDeadCode();
        expect(report.high.map(n => n.qualified_name)).not.toContain('a.ts#AbstractFoo.bar');
    });

    it('LOW tier excludes public symbols tagged trait:internal via node_tags', async () => {
        makeNode(nodeRepo, { qualified_name: 'a.ts#Foo.internalHelper', visibility: 'public', symbol_type: 'method', tags: ['trait:internal'] });
        makeNode(nodeRepo, { qualified_name: 'a.ts#Foo.publicHelper', visibility: 'public', symbol_type: 'method' });

        const report = await optEngine.findDeadCode();
        const lowNames = report.low.map(n => n.qualified_name);
        expect(lowNames).not.toContain('a.ts#Foo.internalHelper');
        expect(lowNames).toContain('a.ts#Foo.publicHelper');
    });

    it('persists tags into the node_tags table on createNode', () => {
        const id = makeNode(nodeRepo, { qualified_name: 'a.ts#Foo.tagged', visibility: 'private', tags: ['trait:entrypoint', 'trait:static'] });

        const rows = db.prepare('SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag').all(id) as { tag: string }[];
        expect(rows.map(r => r.tag)).toEqual(['trait:entrypoint', 'trait:static']);
    });

    it('replacing a node (same qualified_name) replaces its node_tags entries', () => {
        makeNode(nodeRepo, { qualified_name: 'a.ts#Foo.replaced', visibility: 'private', tags: ['trait:entrypoint'] });
        const newId = makeNode(nodeRepo, { qualified_name: 'a.ts#Foo.replaced', visibility: 'private', tags: ['trait:abstract'] });

        const rows = db.prepare('SELECT node_id, tag FROM node_tags').all() as { node_id: number; tag: string }[];
        expect(rows).toEqual([{ node_id: newId, tag: 'trait:abstract' }]);
    });
});

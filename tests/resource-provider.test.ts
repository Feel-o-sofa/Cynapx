/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for registerResourceHandlers() — graph://clusters resource.
 * Phase 12-5 (A-1): per-cluster COUNT(*) (N+1) replaced with a single
 * GROUP BY query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import {
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { registerResourceHandlers } from '../src/server/resource-provider';

function createInMemoryDb(): Database.Database {
    const db = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');
    const filteredSchema = fullSchema
        .split(';')
        .filter(stmt => !stmt.includes('vec0'))
        .join(';');
    db.exec(filteredSchema);
    return db;
}

function makeNode(db: Database.Database, qname: string, clusterId: number | null) {
    db.prepare(`
        INSERT INTO nodes (
            qualified_name, symbol_type, language, file_path, start_line, end_line,
            visibility, is_generated, last_updated_commit, version, cluster_id
        ) VALUES (?, 'function', 'typescript', 'a.ts', 1, 10, 'public', 0, 'abc', 1, ?)
    `).run(qname, clusterId);
}

describe('registerResourceHandlers — graph://clusters', () => {
    let db: Database.Database;
    let handlers: Map<unknown, (req: any) => Promise<any>>;

    beforeEach(() => {
        db = createInMemoryDb();
        handlers = new Map();
        const sdkServer = {
            setRequestHandler: vi.fn((schema: unknown, handler: (req: any) => Promise<any>) => {
                handlers.set(schema, handler);
            }),
        } as any;

        const ctx = {
            dbManager: { getDb: () => db } as any,
            metadataRepo: { getLedgerStats: () => ({}) } as any,
            projectPath: '/mock/project',
            projectHash: 'mock-hash',
        };

        registerResourceHandlers(sdkServer, vi.fn().mockResolvedValue(undefined), () => ctx as any);
    });

    it('lists graph:// resources', async () => {
        const handler = handlers.get(ListResourcesRequestSchema)!;
        const result = await handler({});
        expect(result.resources.map((r: any) => r.uri)).toContain('graph://clusters');
    });

    it('returns node_count per cluster computed via a single GROUP BY query', async () => {
        db.prepare("INSERT INTO logical_clusters (id, name) VALUES (1, 'core')").run();
        db.prepare("INSERT INTO logical_clusters (id, name) VALUES (2, 'utility')").run();

        makeNode(db, 'a.ts#A', 1);
        makeNode(db, 'a.ts#B', 1);
        makeNode(db, 'a.ts#C', 2);
        makeNode(db, 'a.ts#D', null);

        const handler = handlers.get(ReadResourceRequestSchema)!;
        const result = await handler({ params: { uri: 'graph://clusters' } });
        const parsed = JSON.parse(result.contents[0].text);

        const core = parsed.find((c: any) => c.id === 1);
        const utility = parsed.find((c: any) => c.id === 2);
        expect(core.node_count).toBe(2);
        expect(utility.node_count).toBe(1);
    });

    it('returns node_count 0 for clusters with no nodes', async () => {
        db.prepare("INSERT INTO logical_clusters (id, name) VALUES (1, 'empty')").run();

        const handler = handlers.get(ReadResourceRequestSchema)!;
        const result = await handler({ params: { uri: 'graph://clusters' } });
        const parsed = JSON.parse(result.contents[0].text);

        expect(parsed[0].node_count).toBe(0);
    });
});

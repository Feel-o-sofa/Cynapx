/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Tests for the P6 Architecture Intent Model: schema migration,
 * intent load/validation/storage, drift detection, and the
 * get_architecture tool handler.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GraphEngine } from '../src/graph/graph-engine';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { ArchitectureEngine, ArchitectureIntent } from '../src/graph/architecture-engine';
import { DatabaseManager } from '../src/db/database';
import { getArchitectureHandler } from '../src/server/tools/get-architecture';
import { CodeNode, CodeEdge } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadFilteredSchema(db: Database.Database): void {
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');
    // Strip sqlite-vec virtual table (extension not loaded in plain better-sqlite3).
    const filtered = fullSchema.split(';').filter(s => !s.includes('vec0')).join(';');
    db.exec(filtered);
}

function createInMemoryEngine(): {
    db: Database.Database;
    engine: GraphEngine;
    nodeRepo: NodeRepository;
    edgeRepo: EdgeRepository;
    archEngine: ArchitectureEngine;
} {
    const db = new Database(':memory:');
    loadFilteredSchema(db);
    const nodeRepo = new NodeRepository(db);
    const edgeRepo = new EdgeRepository(db);
    const engine = new GraphEngine(nodeRepo, edgeRepo);
    const archEngine = new ArchitectureEngine(engine);
    return { db, engine, nodeRepo, edgeRepo, archEngine };
}

function makeNode(nodeRepo: NodeRepository, qname: string, filePath: string): number {
    return nodeRepo.createNode({
        qualified_name: qname,
        symbol_type: 'function',
        language: 'typescript',
        file_path: filePath,
        start_line: 1,
        end_line: 10,
        visibility: 'public',
        is_generated: false,
        last_updated_commit: 'abc',
        version: 1,
    } as CodeNode);
}

const validIntent: ArchitectureIntent = {
    layers: [
        { name: 'api', pathPattern: 'src/api/', description: 'HTTP entrypoints' },
        { name: 'core', pathPattern: 'src/core/', description: 'Business logic' },
        { name: 'data', pathPattern: 'src/data/', description: 'Persistence' },
        { name: 'ghost', pathPattern: 'src/ghost/', description: 'Never used' },
    ],
    rules: [
        { name: 'data must not call api', from: 'data', to: 'api', allowed: false, rationale: 'Dependencies point inward.' },
    ],
    responsibilities: {
        api: 'Handles transport.',
        core: 'Owns domain rules.',
    },
};

let tmpFiles: string[] = [];
function writeTmp(content: string): string {
    const p = path.join(os.tmpdir(), `arch-intent-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(p, content, 'utf-8');
    tmpFiles.push(p);
    return p;
}

afterEach(() => {
    for (const f of tmpFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    tmpFiles = [];
});

// Minimal ToolDeps stub that only exposes what get_architecture touches.
function makeDeps(archEngine: ArchitectureEngine | null): any {
    return {
        getContext: () => archEngine === null ? null : { archEngine, policyDiscoverer: undefined },
    };
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------
describe('P6 schema migration', () => {
    it('creates the architecture_intent table via DatabaseManager migration', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-mig-'));
        const dbPath = path.join(dir, 'test.db');
        // DatabaseManager loads schema.sql + runs migrations. schema.sql contains a
        // vec0 virtual table requiring the sqlite-vec extension, which DatabaseManager
        // loads itself, so this exercises the real migration path.
        const mgr = new DatabaseManager(dbPath);
        const db = mgr.getDb();
        const tbl = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='architecture_intent'"
        ).get();
        expect(tbl).toBeDefined();
        const version = db.pragma('user_version', { simple: true });
        expect(version).toBeGreaterThanOrEqual(5);
        mgr.dispose();
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });
});

// ---------------------------------------------------------------------------
// loadIntent / getIntent
// ---------------------------------------------------------------------------
describe('ArchitectureEngine.loadIntent / getIntent', () => {
    it('getIntent() returns null when no intent stored', () => {
        const { archEngine } = createInMemoryEngine();
        expect(archEngine.getIntent()).toBeNull();
    });

    it('loadIntent() reads, validates and stores a valid config', () => {
        const { archEngine } = createInMemoryEngine();
        const p = writeTmp(JSON.stringify(validIntent));
        const result = archEngine.loadIntent(p);
        expect(result.layers).toHaveLength(4);
        expect(archEngine.hasCustomRules).toBe(true);

        const stored = archEngine.getIntent();
        expect(stored).not.toBeNull();
        expect(stored!.layers.map(l => l.name)).toContain('api');
        expect(stored!.rules[0].name).toBe('data must not call api');
    });

    it('loadIntent() preserves rationale on rules in stored output', () => {
        const { archEngine } = createInMemoryEngine();
        const p = writeTmp(JSON.stringify(validIntent));
        archEngine.loadIntent(p);
        const stored = archEngine.getIntent();
        expect(stored!.rules[0].rationale).toBe('Dependencies point inward.');
    });

    it('loadIntent() upserts (id=1 singleton, second load replaces)', () => {
        const { archEngine, db } = createInMemoryEngine();
        archEngine.loadIntent(writeTmp(JSON.stringify(validIntent)));
        const other: ArchitectureIntent = { layers: [{ name: 'x', pathPattern: 'x/' }], rules: [], responsibilities: {} };
        archEngine.loadIntent(writeTmp(JSON.stringify(other)));
        const rows = db.prepare('SELECT COUNT(*) AS c FROM architecture_intent').get() as { c: number };
        expect(rows.c).toBe(1);
        expect(archEngine.getIntent()!.layers).toHaveLength(1);
    });

    it('loadIntent() rejects a non-object config', () => {
        const { archEngine } = createInMemoryEngine();
        const p = writeTmp(JSON.stringify([1, 2, 3]));
        expect(() => archEngine.loadIntent(p)).toThrow(/expected a JSON object/i);
    });

    it('loadIntent() rejects a config missing required fields', () => {
        const { archEngine } = createInMemoryEngine();
        const p = writeTmp(JSON.stringify({ layers: [] }));
        expect(() => archEngine.loadIntent(p)).toThrow(/'rules' must be an array/i);
    });

    it('loadIntent() rejects invalid JSON', () => {
        const { archEngine } = createInMemoryEngine();
        const p = writeTmp('{ not valid json }');
        expect(() => archEngine.loadIntent(p)).toThrow(/invalid JSON/i);
    });
});

// ---------------------------------------------------------------------------
// compareIntentVsReality / DriftReport
// ---------------------------------------------------------------------------
describe('ArchitectureEngine.compareIntentVsReality', () => {
    function seedGraph(nodeRepo: NodeRepository, edgeRepo: EdgeRepository) {
        const dataId = makeNode(nodeRepo, 'data/repo', 'src/data/repo.ts');
        const apiId = makeNode(nodeRepo, 'api/handler', 'src/api/handler.ts');
        makeNode(nodeRepo, 'core/service', 'src/core/service.ts');
        // Forbidden edge: data -> api
        edgeRepo.createEdge({ from_id: dataId, to_id: apiId, edge_type: 'calls' } as CodeEdge);
    }

    it('returns a drift report with declared layers and rule health', async () => {
        const { archEngine, nodeRepo, edgeRepo } = createInMemoryEngine();
        seedGraph(nodeRepo, edgeRepo);
        archEngine.loadIntent(writeTmp(JSON.stringify(validIntent)));

        const drift = await archEngine.compareIntentVsReality();
        expect(drift.declaredLayers.find(l => l.name === 'api')!.nodeCount).toBeGreaterThan(0);
        expect(drift.declaredLayers.find(l => l.name === 'data')!.nodeCount).toBeGreaterThan(0);

        const ruleHealth = drift.ruleHealth.find(r => r.rule.name === 'data must not call api');
        expect(ruleHealth).toBeDefined();
        expect(ruleHealth!.status).toBe('violated');
        expect(ruleHealth!.violationCount).toBeGreaterThan(0);
    });

    it('reports unmapped layers (declared but zero matching nodes)', async () => {
        const { archEngine, nodeRepo, edgeRepo } = createInMemoryEngine();
        seedGraph(nodeRepo, edgeRepo);
        archEngine.loadIntent(writeTmp(JSON.stringify(validIntent)));

        const drift = await archEngine.compareIntentVsReality();
        expect(drift.unmappedLayers).toContain('ghost');
        expect(drift.unmappedLayers).not.toContain('api');
    });

    it('returns an empty report when no intent is stored', async () => {
        const { archEngine } = createInMemoryEngine();
        const drift = await archEngine.compareIntentVsReality();
        expect(drift.declaredLayers).toHaveLength(0);
        expect(drift.unmappedLayers).toHaveLength(0);
        expect(drift.ruleHealth).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// get_architecture tool handler
// ---------------------------------------------------------------------------
describe('get_architecture tool', () => {
    it('returns intent and drift when populated', async () => {
        const { archEngine, nodeRepo, edgeRepo } = createInMemoryEngine();
        makeNode(nodeRepo, 'api/handler', 'src/api/handler.ts');
        edgeRepo; // unused beyond seeding API node
        archEngine.loadIntent(writeTmp(JSON.stringify(validIntent)));

        const res = await getArchitectureHandler.execute({}, makeDeps(archEngine));
        const text = res.content[0].text;
        expect(res.isError).toBeFalsy();
        expect(text).toContain('Declared Layers');
        expect(text).toContain('Responsibilities');
        expect(text).toContain('Rules');
        // rationale surfaced in output
        expect(text).toContain('Dependencies point inward.');
        // unmapped layer surfaced
        expect(text).toContain('ghost');
    });

    it('handles no intent gracefully', async () => {
        const { archEngine } = createInMemoryEngine();
        const res = await getArchitectureHandler.execute({}, makeDeps(archEngine));
        expect(res.isError).toBeFalsy();
        expect(res.content[0].text).toContain('cynapx.architecture.json');
    });

    it('errors when no active project', async () => {
        const res = await getArchitectureHandler.execute({}, makeDeps(null));
        expect(res.isError).toBe(true);
    });
});

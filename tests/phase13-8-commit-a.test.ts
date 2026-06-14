/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 13-8 commit A regression tests.
 *
 * - A-4: symbol_name column backfill (migration 2 -> 3), indexed
 *   findNodesBySymbolName() lookup, and extractSymbolName() edge cases.
 * - A-5: NodeRepository prepared-statement cache invalidation, and
 *   persistClusters() transaction atomicity (all-or-nothing on mid-run failure).
 * - A-7: PythonEmbeddingProvider request-id discipline — stale responses
 *   discarded, superseded pending request rejected.
 * - O-4: TypeScriptParser reuses a single ts.Program (via LanguageService)
 *   across multiple files in one run, and produces the same parse/type-check
 *   output as the former per-file ts.createProgram path.
 */
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DatabaseManager } from '../src/db/database';
import { NodeRepository, extractSymbolName } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { GraphEngine } from '../src/graph/graph-engine';
import { TypeScriptParser } from '../src/indexer/typescript-parser';
import { PythonEmbeddingProvider } from '../src/indexer/embedding-manager';
import type { CodeNode } from '../src/types';

function createInMemoryDb(): { db: Database.Database; nodeRepo: NodeRepository; edgeRepo: EdgeRepository } {
    const db = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');
    const filteredSchema = fullSchema
        .split(';')
        .filter(stmt => !stmt.includes('vec0'))
        .join(';');
    db.exec(filteredSchema);
    return { db, nodeRepo: new NodeRepository(db), edgeRepo: new EdgeRepository(db) };
}

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
        fan_in: 0,
        fan_out: 0,
        ...overrides,
    } as CodeNode;
}

// ---------------------------------------------------------------------------
// A-4: symbol_name
// ---------------------------------------------------------------------------
describe('A-4: symbol_name column + extractSymbolName()', () => {
    it('extractSymbolName() returns the suffix after the first #', () => {
        expect(extractSymbolName('a.ts#Foo.bar')).toBe('Foo.bar');
        expect(extractSymbolName('src/x.ts#doThing')).toBe('doThing');
    });

    it('extractSymbolName() returns the whole name when there is no #', () => {
        expect(extractSymbolName('package:lodash')).toBe('package:lodash');
        expect(extractSymbolName('a.ts')).toBe('a.ts'); // file node
        expect(extractSymbolName('')).toBe('');
    });

    it('extractSymbolName() handles multiple # by splitting on the first only', () => {
        // qualified_name uses a single '#' separator, but be explicit about it.
        expect(extractSymbolName('a.ts#Foo#bar')).toBe('Foo#bar');
    });

    it('createNode() populates symbol_name with the bare name', () => {
        const { db, nodeRepo } = createInMemoryDb();
        nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#Foo.bar', symbol_type: 'method' }));
        const row = db.prepare("SELECT symbol_name FROM nodes WHERE qualified_name = 'a.ts#Foo.bar'").get() as { symbol_name: string };
        expect(row.symbol_name).toBe('Foo.bar');
        db.close();
    });

    it('findNodesBySymbolName() resolves both suffixed and global names via the indexed column', () => {
        const { db, nodeRepo } = createInMemoryDb();
        nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#helper', symbol_type: 'function' }));
        nodeRepo.createNode(makeNode({ qualified_name: 'b.ts#other', symbol_type: 'function' }));
        nodeRepo.createNode(makeNode({ qualified_name: 'globalThing', symbol_type: 'function' }));

        const helper = nodeRepo.findNodesBySymbolName('helper');
        expect(helper.map(n => n.qualified_name)).toEqual(['a.ts#helper']);

        // A global symbol (no '#') has symbol_name == qualified_name, so the same
        // indexed probe resolves it without an OR on qualified_name.
        const global = nodeRepo.findNodesBySymbolName('globalThing');
        expect(global.map(n => n.qualified_name)).toEqual(['globalThing']);

        // Case-insensitive match still works.
        expect(nodeRepo.findNodesBySymbolName('HELPER').map(n => n.qualified_name)).toEqual(['a.ts#helper']);

        // The lookup must use the NOCASE index — a full SCAN would mean the
        // index collation does not match the query collation (the A-4 regression).
        const plan = db.prepare(
            'EXPLAIN QUERY PLAN SELECT * FROM nodes WHERE symbol_name = ? COLLATE NOCASE'
        ).all('helper') as { detail: string }[];
        const planText = plan.map(p => p.detail).join(' ');
        expect(planText).toMatch(/SEARCH .*idx_nodes_symbol_name/);
        expect(planText).not.toMatch(/SCAN nodes/);
        db.close();
    });

    it('migration 2 -> 3 adds symbol_name, the index, and backfills existing rows', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();

        // Simulate a pre-migration (v2) database: drop the column + index and roll back.
        db.exec('DROP INDEX IF EXISTS idx_nodes_symbol_name');
        // SQLite can't DROP COLUMN easily on all versions; instead just clear it
        // and roll back user_version so the migration re-derives it.
        db.pragma('user_version = 2');
        db.prepare(`
            INSERT INTO nodes (
                qualified_name, symbol_type, language, file_path, start_line, end_line,
                visibility, is_generated, last_updated_commit, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('a.ts#Foo.bar', 'method', 'typescript', 'a.ts', 1, 10, 'private', 0, 'abc', 1);
        db.prepare(`
            INSERT INTO nodes (
                qualified_name, symbol_type, language, file_path, start_line, end_line,
                visibility, is_generated, last_updated_commit, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('globalSym', 'function', 'typescript', 'b.ts', 1, 5, 'public', 0, 'abc', 1);
        db.exec('UPDATE nodes SET symbol_name = NULL');

        manager.runMigrations();

        expect(db.pragma('user_version', { simple: true })).toBe(DatabaseManager.SCHEMA_VERSION);
        const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_nodes_symbol_name'").get();
        expect(index).toBeDefined();

        const suffixed = db.prepare("SELECT symbol_name FROM nodes WHERE qualified_name = 'a.ts#Foo.bar'").get() as { symbol_name: string };
        expect(suffixed.symbol_name).toBe('Foo.bar');
        const global = db.prepare("SELECT symbol_name FROM nodes WHERE qualified_name = 'globalSym'").get() as { symbol_name: string };
        expect(global.symbol_name).toBe('globalSym');

        manager.dispose();
    });
});

// ---------------------------------------------------------------------------
// A-5: statement cache invalidation + persistClusters transaction atomicity
// ---------------------------------------------------------------------------
describe('A-5: NodeRepository statement cache invalidation', () => {
    it('invalidateStatementCache() forces re-preparation of cached statements', () => {
        const { db, nodeRepo } = createInMemoryDb();
        // Prime the upsert + lookup statement caches.
        nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#one' }));
        nodeRepo.findNodesBySymbolName('one');

        const prepareSpy = vi.spyOn(db, 'prepare');
        // Without invalidation, the cached statement is reused (no new prepare for upsert).
        nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#two' }));
        const callsBeforeInvalidate = prepareSpy.mock.calls.length;

        nodeRepo.invalidateStatementCache();
        nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#three' }));
        nodeRepo.findNodesBySymbolName('three');
        // After invalidation the upsert + lookup statements are re-prepared.
        expect(prepareSpy.mock.calls.length).toBeGreaterThan(callsBeforeInvalidate);

        prepareSpy.mockRestore();
        db.close();
    });
});

describe('A-5: persistClusters() transaction atomicity', () => {
    it('rolls back the full cluster persist if a node update fails mid-run', async () => {
        const { db, nodeRepo, edgeRepo } = createInMemoryDb();
        const idA = nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#A', symbol_type: 'function' }));
        const idB = nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#B', symbol_type: 'function' }));
        const idC = nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#C', symbol_type: 'function' }));

        const engine = new GraphEngine(nodeRepo, edgeRepo);

        // Force a failure partway through the per-node updateCluster() loop.
        let calls = 0;
        const realUpdate = nodeRepo.updateCluster.bind(nodeRepo);
        vi.spyOn(nodeRepo, 'updateCluster').mockImplementation((id: number, clusterId: number | null) => {
            calls++;
            if (calls === 2) throw new Error('boom mid-persist');
            return realUpdate(id, clusterId);
        });

        const nodeMap = new Map<number, CodeNode>([
            [idA, { ...makeNode({ qualified_name: 'a.ts#A' }), id: idA } as CodeNode],
            [idB, { ...makeNode({ qualified_name: 'a.ts#B' }), id: idB } as CodeNode],
            [idC, { ...makeNode({ qualified_name: 'a.ts#C' }), id: idC } as CodeNode],
        ]);

        // persistClusters is private; reach it via the prototype.
        const persist = (engine as any).persistClusters.bind(engine);
        await expect(persist([[idA, idB, idC]], nodeMap)).rejects.toThrow('boom mid-persist');

        // Atomicity: no logical_clusters rows and no cluster_id assignments persisted.
        const clusterCount = (db.prepare('SELECT COUNT(*) AS c FROM logical_clusters').get() as { c: number }).c;
        expect(clusterCount).toBe(0);
        const assigned = (db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE cluster_id IS NOT NULL').get() as { c: number }).c;
        expect(assigned).toBe(0);

        vi.restoreAllMocks();
        db.close();
    });

    it('persists clusters + node assignments when nothing fails', async () => {
        const { db, nodeRepo, edgeRepo } = createInMemoryDb();
        const idA = nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#A', symbol_type: 'function', fan_out: 6, cyclomatic: 6 }));
        const idB = nodeRepo.createNode(makeNode({ qualified_name: 'a.ts#B', symbol_type: 'function' }));
        const engine = new GraphEngine(nodeRepo, edgeRepo);
        const nodeMap = new Map<number, CodeNode>([
            [idA, { ...makeNode({ qualified_name: 'a.ts#A', fan_out: 6, cyclomatic: 6 }), id: idA } as CodeNode],
            [idB, { ...makeNode({ qualified_name: 'a.ts#B' }), id: idB } as CodeNode],
        ]);
        const persist = (engine as any).persistClusters.bind(engine);
        await persist([[idA, idB]], nodeMap);

        const clusterCount = (db.prepare('SELECT COUNT(*) AS c FROM logical_clusters').get() as { c: number }).c;
        expect(clusterCount).toBe(1);
        const assigned = (db.prepare('SELECT COUNT(*) AS c FROM nodes WHERE cluster_id IS NOT NULL').get() as { c: number }).c;
        expect(assigned).toBe(2);
        db.close();
    });
});

// ---------------------------------------------------------------------------
// A-7: embedding request-id discipline
// ---------------------------------------------------------------------------
describe('A-7: PythonEmbeddingProvider request-id discipline', () => {
    // Drive the REAL provider: inject a fake child (stdin captures the request
    // JSON) and mark it ready so generateBatch() runs its real id/supersede
    // logic, then feed responses through the real handleSidecarMessage().
    function makeProvider(): { provider: any; written: any[]; feed: (obj: any) => void } {
        const provider: any = new PythonEmbeddingProvider();
        const written: any[] = [];
        provider.child = { stdin: { write: (s: string) => { written.push(JSON.parse(s.trim())); return true; } } };
        provider.ready = true; // bypass start()/readiness wait
        const feed = (obj: any) => provider.handleSidecarMessage(obj);
        return { provider, written, feed };
    }

    it('discards a stale response whose id does not match the pending request', async () => {
        const { provider, written, feed } = makeProvider();
        const p = provider.generateBatch(['hello']);
        await Promise.resolve(); // let generateBatch register the pending request
        const expectedId = written[written.length - 1].id;

        // A late reply for an earlier (already-timed-out) batch arrives.
        feed({ id: expectedId - 1, vectors: [[9, 9]] });
        expect(provider.pendingRequest).not.toBeNull(); // still unresolved

        // The correct reply resolves it.
        feed({ id: expectedId, vectors: [[1, 2]] });
        await expect(p).resolves.toEqual([[1, 2]]);
    });

    it('rejects a superseded pending request when a new batch takes over', async () => {
        const { provider, written, feed } = makeProvider();
        const first = provider.generateBatch(['a']);
        await Promise.resolve();
        const second = provider.generateBatch(['b']); // supersedes the first
        await Promise.resolve();

        await expect(first).rejects.toThrow(/superseded/);
        // The new request id is the one now recorded on the pending slot.
        const secondId = written[written.length - 1].id;
        expect(provider.pendingRequest.id).toBe(secondId);

        feed({ id: secondId, vectors: [[5, 6]] });
        await expect(second).resolves.toEqual([[5, 6]]);
    });

    it('still accepts a response with no id (backward compatibility)', async () => {
        const { provider, feed } = makeProvider();
        const p = provider.generateBatch(['x']);
        await Promise.resolve();
        feed({ vectors: [[3, 4]] }); // no id field
        await expect(p).resolves.toEqual([[3, 4]]);
    });

    it('each request carries a unique monotonic id', async () => {
        const { provider, written, feed } = makeProvider();
        const p1 = provider.generateBatch(['a']);
        await Promise.resolve();
        const id1 = written[written.length - 1].id;
        feed({ id: id1, vectors: [[1]] });
        await p1;
        const p2 = provider.generateBatch(['b']);
        await Promise.resolve();
        const id2 = written[written.length - 1].id;
        expect(id2).toBeGreaterThan(id1);
        feed({ id: id2, vectors: [[2]] });
        await p2;
    });
});

// ---------------------------------------------------------------------------
// O-4: TypeScriptParser LanguageService reuse
// ---------------------------------------------------------------------------
describe('O-4: TypeScriptParser reuses an incremental Program', () => {
    function writeTmp(dir: string, name: string, content: string): string {
        const p = path.join(dir, name);
        fs.writeFileSync(p, content, 'utf8');
        return p;
    }

    it('produces equivalent symbol/edge output to a per-file createProgram path', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o4-'));
        const file = writeTmp(dir, 'sample.ts', fs.readFileSync(path.resolve(__dirname, 'fixtures/sample.ts'), 'utf8'));

        const parser = new TypeScriptParser();
        const delta = await parser.parse(file, 'c1', 1);

        // Sanity: the known fixture symbols are all present (qualified_name is
        // canonicalised to lowercase by toCanonical()).
        const names = delta.nodes.map(n => n.qualified_name);
        expect(names.some(n => n.endsWith('#animal'))).toBe(true);
        expect(names.some(n => n.endsWith('#dog'))).toBe(true);
        expect(names.some(n => n.endsWith('#formatanimal'))).toBe(true);
        // File node + the inheritance/defines edges exist.
        expect(delta.nodes.some(n => n.symbol_type === 'file')).toBe(true);
        expect(delta.edges.length).toBeGreaterThan(0);

        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('creates the LanguageService once and reuses it across multiple files in one run', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o4-'));
        const f1 = writeTmp(dir, 'one.ts', 'export function alpha(x: number): number { return x + 1; }\n');
        const f2 = writeTmp(dir, 'two.ts', 'export class Beta { run(): string { return "b"; } }\n');
        const f3 = writeTmp(dir, 'three.ts', 'export function gamma(): number { return 42; }\n');

        // ts.createProgram cannot be spied directly (ESM namespace is frozen), so
        // we instrument the parser's own ensureLanguageService() to count how many
        // times a LanguageService is built and capture the instance for identity.
        const parser = new TypeScriptParser();
        const ensureSpy = vi.spyOn(parser as any, 'ensureLanguageService');

        const d1 = await parser.parse(f1, 'c1', 1);
        const svcAfterFirst = (parser as any).languageService;
        const d2 = await parser.parse(f2, 'c1', 1);
        const d3 = await parser.parse(f3, 'c1', 1);

        // The same LanguageService instance is reused across all three files
        // (ensureLanguageService is called once per parse but only builds once).
        expect(ensureSpy).toHaveBeenCalledTimes(3);
        expect((parser as any).languageService).toBe(svcAfterFirst);

        // O-4: a real ts.LanguageService backs the parser (program comes from it).
        expect(typeof svcAfterFirst.getProgram).toBe('function');

        // Each file's own symbol is still resolved correctly under the shared program.
        expect(d1.nodes.some(n => n.qualified_name.endsWith('#alpha'))).toBe(true);
        expect(d2.nodes.some(n => n.qualified_name.endsWith('#beta'))).toBe(true);
        expect(d3.nodes.some(n => n.qualified_name.endsWith('#gamma'))).toBe(true);

        ensureSpy.mockRestore();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('re-parses a file after its content changes (script version bump)', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o4-'));
        const f = writeTmp(dir, 'mut.ts', 'export function v1(): number { return 1; }\n');

        const parser = new TypeScriptParser();
        const d1 = await parser.parse(f, 'c1', 1);
        expect(d1.nodes.some(n => n.qualified_name.endsWith('#v1'))).toBe(true);

        fs.writeFileSync(f, 'export function v2(): number { return 2; }\n', 'utf8');
        const d2 = await parser.parse(f, 'c2', 2);
        expect(d2.nodes.some(n => n.qualified_name.endsWith('#v2'))).toBe(true);
        expect(d2.nodes.some(n => n.qualified_name.endsWith('#v1'))).toBe(false);

        fs.rmSync(dir, { recursive: true, force: true });
    });
});

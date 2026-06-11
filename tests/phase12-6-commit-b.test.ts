/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 12-6 commit B (indexer cleanup):
 * - O-2: update-pipeline resolveNodeId() canonical-key lookup (no full re-scan)
 * - O-3: cross-project-resolver caches remote DB connections within a batch
 * - O-10: worker-pool task timeout/message settle guard
 * - O-11: index-worker top-level uncaughtException/unhandledRejection handlers
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { toCanonical } from '../src/utils/paths';
import { CrossProjectResolver } from '../src/indexer/cross-project-resolver';
import { NodeRepository } from '../src/db/node-repository';

describe('O-2: toCanonical idempotency (resolveNodeId canonical-key lookup)', () => {
    it('toCanonical(toCanonical(x)) === toCanonical(x)', () => {
        const samples = ['a.ts#Foo.bar', '/abs/path/a.ts#Foo', 'src\\windows\\path.ts#Bar'];
        for (const s of samples) {
            const once = toCanonical(s);
            const twice = toCanonical(once);
            expect(twice).toBe(once);
        }
    });

    it('a symbolCache keyed by canonical names is found via direct lookup', () => {
        const symbolCache = new Map<string, number>();
        symbolCache.set(toCanonical('a.ts#Foo.bar'), 42);

        const lookupKey = toCanonical('a.ts#Foo.bar');
        expect(symbolCache.has(lookupKey)).toBe(true);
        expect(symbolCache.get(lookupKey)).toBe(42);
    });
});

function createRemoteDb(dbPath: string, qualifiedName: string): void {
    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qualified_name TEXT NOT NULL,
            symbol_type TEXT NOT NULL,
            language TEXT NOT NULL,
            file_path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            visibility TEXT NOT NULL,
            signature TEXT,
            return_type TEXT,
            tags TEXT,
            history TEXT
        );
    `);
    db.prepare(`
        INSERT INTO nodes (qualified_name, symbol_type, language, file_path, start_line, end_line, visibility)
        VALUES (?, 'function', 'typescript', 'remote.ts', 1, 5, 'public')
    `).run(qualifiedName);
    db.close();
}

describe('O-3: CrossProjectResolver batch DB connection caching', () => {
    let tmpDir: string;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('reuses the same remote DB connection across resolve() calls within a batch, and closes it on endBatch', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-cross-project-'));
        const remoteDbPath = path.join(tmpDir, 'remote.db');
        createRemoteDb(remoteDbPath, 'remote.ts#sharedHelper');

        const pathsModule = await import('../src/utils/paths');
        vi.spyOn(pathsModule, 'readRegistry').mockReturnValue([
            {
                name: 'other-project',
                path: '/other/project',
                db_path: remoteDbPath,
                last_accessed_at: new Date().toISOString(),
            },
        ]);

        const localDb = new Database(':memory:');
        const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
        const fullSchema = fs.readFileSync(schemaPath, 'utf8');
        localDb.exec(fullSchema.split(';').filter(stmt => !stmt.includes('vec0')).join(';'));
        const nodeRepo = new NodeRepository(localDb);

        const resolver = new CrossProjectResolver(nodeRepo, '/local/project');

        resolver.beginBatch();

        const id1 = resolver.resolve('sharedHelper', toCanonical('sharedHelper'));
        const id2 = resolver.resolve('sharedHelper2', toCanonical('sharedHelper2'));

        expect(id1).toBeDefined();
        // Second call doesn't match (different symbol name) but should not throw
        // and should reuse the cached connection.
        expect(id2).toBeUndefined();

        const cache = (resolver as any).batchDbCache as Map<string, Database.Database>;
        expect(cache.size).toBe(1);
        const cachedDb = cache.get(remoteDbPath)!;
        expect(cachedDb.open).toBe(true);

        resolver.endBatch();

        expect((resolver as any).batchDbCache).toBeNull();
        expect(cachedDb.open).toBe(false);

        localDb.close();
    });

    it('M1: closes and evicts a cached connection when resolve() fails for that DB', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-cross-project-'));
        const remoteDbPath = path.join(tmpDir, 'remote.db');
        createRemoteDb(remoteDbPath, 'remote.ts#sharedHelper');

        const pathsModule = await import('../src/utils/paths');
        vi.spyOn(pathsModule, 'readRegistry').mockReturnValue([
            {
                name: 'other-project',
                path: '/other/project',
                db_path: remoteDbPath,
                last_accessed_at: new Date().toISOString(),
            },
        ]);

        const localDb = new Database(':memory:');
        const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
        const fullSchema = fs.readFileSync(schemaPath, 'utf8');
        localDb.exec(fullSchema.split(';').filter(stmt => !stmt.includes('vec0')).join(';'));
        const nodeRepo = new NodeRepository(localDb);

        const resolver = new CrossProjectResolver(nodeRepo, '/local/project');
        resolver.beginBatch();

        // First resolve succeeds and caches the connection.
        expect(resolver.resolve('sharedHelper', toCanonical('sharedHelper'))).toBeDefined();
        const cache = (resolver as any).batchDbCache as Map<string, Database.Database>;
        const cachedDb = cache.get(remoteDbPath)!;
        expect(cachedDb.open).toBe(true);

        // Break the cached connection: subsequent prepare() throws.
        const prepareSpy = vi.spyOn(cachedDb, 'prepare').mockImplementation(() => {
            throw new Error('disk I/O error');
        });

        expect(resolver.resolve('sharedHelper', toCanonical('sharedHelper'))).toBeUndefined();

        // The broken connection must be closed AND removed from the cache —
        // not leaked (pre-fix: deleted without close) nor kept (pre-fix:
        // already-cached broken connection failed for the rest of the batch).
        expect(prepareSpy).toHaveBeenCalled();
        expect(cache.has(remoteDbPath)).toBe(false);
        expect(cachedDb.open).toBe(false);

        // The next resolve in the same batch reopens a fresh connection and succeeds.
        expect(resolver.resolve('sharedHelper', toCanonical('sharedHelper'))).toBeDefined();
        expect(cache.get(remoteDbPath)?.open).toBe(true);

        resolver.endBatch();
        localDb.close();
    });

    it('still resolves correctly without beginBatch (open/close per call)', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-cross-project-'));
        const remoteDbPath = path.join(tmpDir, 'remote.db');
        createRemoteDb(remoteDbPath, 'remote.ts#anotherHelper');

        const pathsModule = await import('../src/utils/paths');
        vi.spyOn(pathsModule, 'readRegistry').mockReturnValue([
            {
                name: 'other-project',
                path: '/other/project',
                db_path: remoteDbPath,
                last_accessed_at: new Date().toISOString(),
            },
        ]);

        const localDb = new Database(':memory:');
        const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
        const fullSchema = fs.readFileSync(schemaPath, 'utf8');
        localDb.exec(fullSchema.split(';').filter(stmt => !stmt.includes('vec0')).join(';'));
        const nodeRepo = new NodeRepository(localDb);

        const resolver = new CrossProjectResolver(nodeRepo, '/local/project');
        const id = resolver.resolve('anotherHelper', toCanonical('anotherHelper'));
        expect(id).toBeDefined();

        localDb.close();
    });
});

// O-10: drive the timeout-vs-message settle race with a fake Worker so we
// don't depend on spawning real worker threads / compiled worker bundles.
class FakeWorker extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn().mockResolvedValue(undefined);
}

describe('O-10: WorkerPool task timeout/message settle guard', () => {
    afterEach(() => {
        vi.doUnmock('worker_threads');
        vi.resetModules();
        vi.useRealTimers();
    });

    it('clears the timeout once a message arrives, so it never double-settles', async () => {
        const fakeWorkers: FakeWorker[] = [];
        vi.doMock('worker_threads', () => ({
            Worker: class {
                constructor() {
                    const w = new FakeWorker();
                    fakeWorkers.push(w);
                    return w as any;
                }
            },
        }));

        const { WorkerPool } = await import('../src/indexer/worker-pool');
        const pool = new WorkerPool(1, { maxQueueSize: 5 });

        const taskPromise = pool.runTask({ filePath: 'a.ts', commit: 'abc', version: 1 });

        // Simulate the worker responding with a successful result.
        const worker = fakeWorkers[0];
        worker.emit('message', { status: 'success', delta: { nodes: [], edges: [] }, filePath: 'a.ts' });

        await expect(taskPromise).resolves.toEqual({ nodes: [], edges: [] });

        // The worker should be free again — a second task is dispatched immediately.
        const second = pool.runTask({ filePath: 'b.ts', commit: 'abc', version: 1 });
        expect(worker.postMessage).toHaveBeenCalledTimes(2);
        worker.emit('message', { status: 'success', delta: { nodes: [], edges: [] }, filePath: 'b.ts' });
        await expect(second).resolves.toEqual({ nodes: [], edges: [] });

        pool.dispose();
    });

    it('replaces the worker and rejects the task when it times out', async () => {
        vi.useFakeTimers();
        const fakeWorkers: FakeWorker[] = [];
        vi.doMock('worker_threads', () => ({
            Worker: class {
                constructor() {
                    const w = new FakeWorker();
                    fakeWorkers.push(w);
                    return w as any;
                }
            },
        }));

        const { WorkerPool } = await import('../src/indexer/worker-pool');
        const pool = new WorkerPool(1, { maxQueueSize: 5 });

        const taskPromise = pool.runTask({ filePath: 'a.ts', commit: 'abc', version: 1 });
        const expectation = expect(taskPromise).rejects.toThrow(/timed out/);

        await vi.advanceTimersByTimeAsync(30_001);
        await expectation;

        // A replacement worker should have been spawned.
        expect(fakeWorkers.length).toBe(2);
        expect(fakeWorkers[0].terminate).toHaveBeenCalled();

        pool.dispose();
    });

    it('rejects queued tasks on dispose without leaving them pending', async () => {
        const fakeWorkers: FakeWorker[] = [];
        vi.doMock('worker_threads', () => ({
            Worker: class {
                constructor() {
                    const w = new FakeWorker();
                    fakeWorkers.push(w);
                    return w as any;
                }
            },
        }));

        const { WorkerPool } = await import('../src/indexer/worker-pool');
        const pool = new WorkerPool(1, { maxQueueSize: 5 });

        // Occupy the only worker, then queue a second task.
        const first = pool.runTask({ filePath: 'a.ts', commit: 'abc', version: 1 });
        const second = pool.runTask({ filePath: 'b.ts', commit: 'abc', version: 1 });

        pool.dispose();

        await expect(second).rejects.toThrow('WorkerPool disposed');
        await expect(first).rejects.toThrow('WorkerPool disposed');
    });
});

describe('O-11: index-worker top-level handlers', () => {
    // M5: importing index-worker installs re-throwing process handlers in the
    // vitest process. Capture exactly the listeners the import added and
    // remove them afterwards so they cannot affect other tests.
    const addedListeners: Array<{ event: 'uncaughtException' | 'unhandledRejection'; listener: (...args: any[]) => void }> = [];

    afterAll(() => {
        for (const { event, listener } of addedListeners) {
            process.removeListener(event, listener as any);
        }
    });

    it('registers uncaughtException and unhandledRejection handlers on import', async () => {
        const beforeUncaught = process.listeners('uncaughtException');
        const beforeUnhandled = process.listeners('unhandledRejection');

        vi.resetModules();
        await import('../src/indexer/index-worker');

        const newUncaught = process.listeners('uncaughtException').filter(l => !beforeUncaught.includes(l));
        const newUnhandled = process.listeners('unhandledRejection').filter(l => !beforeUnhandled.includes(l));

        expect(newUncaught.length).toBeGreaterThan(0);
        expect(newUnhandled.length).toBeGreaterThan(0);

        for (const listener of newUncaught) addedListeners.push({ event: 'uncaughtException', listener });
        for (const listener of newUnhandled) addedListeners.push({ event: 'unhandledRejection', listener });
    });
});

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 13-6 (H-6): WorkspaceManager.unmountProject() lifecycle teardown.
 *
 * Verifies that after a purge-style unmount:
 *   - every engine field that wrapped the (now closed) DB connection is nulled,
 *   - the watcher / worker pool attached to the context are disposed,
 *   - re-initialization (mountProject again -> initializeEngine) passes the
 *     `if (ctx.dbManager) return` guard correctly and rebuilds the engine, and
 *   - no live reference to the closed DB handle survives.
 *
 * HOME is stubbed to a temp dir so initializeEngine's getDatabasePath()
 * (~/.cynapx/<hash>_v2.db) writes inside the sandbox.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceManager } from '../src/server/workspace-manager';

let fakeHome: string;
let projectDir: string;

beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-wm-home-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-wm-proj-'));
    vi.stubEnv('HOME', fakeHome);
    vi.stubEnv('USERPROFILE', fakeHome);
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('WorkspaceManager.unmountProject (H-6)', () => {
    it('nulls every engine field after unmount', async () => {
        const wm = new WorkspaceManager();
        const ctx = await wm.mountProject(projectDir);
        await wm.initializeEngine(ctx.projectHash);

        // Sanity: engines were built.
        expect(ctx.dbManager).toBeDefined();
        expect(ctx.graphEngine).toBeDefined();
        expect(ctx.metadataRepo).toBeDefined();
        expect(ctx.optEngine).toBeDefined();
        expect(ctx.archEngine).toBeDefined();

        await wm.unmountProject(ctx.projectHash);

        // All engine/DB fields cleared.
        expect(ctx.dbManager).toBeUndefined();
        expect(ctx.graphEngine).toBeUndefined();
        expect(ctx.metadataRepo).toBeUndefined();
        expect(ctx.vectorRepo).toBeUndefined();
        expect(ctx.archEngine).toBeUndefined();
        expect(ctx.refactorEngine).toBeUndefined();
        expect(ctx.optEngine).toBeUndefined();
        expect(ctx.policyDiscoverer).toBeUndefined();
        expect(ctx.gitService).toBeUndefined();
        expect(ctx.updatePipeline).toBeUndefined();
        expect(ctx.securityProvider).toBeUndefined();

        // Context remains mounted (path + hash) for re-init.
        expect(wm.getContextByHash(ctx.projectHash)).toBe(ctx);
    });

    it('disposes the attached watcher and worker pool in order', async () => {
        const wm = new WorkspaceManager();
        const ctx = await wm.mountProject(projectDir);
        await wm.initializeEngine(ctx.projectHash);

        const order: string[] = [];
        const watcher = { dispose: vi.fn(() => { order.push('watcher'); }) };
        const workerPool = { dispose: vi.fn(() => { order.push('workerPool'); }) };
        ctx.watcher = watcher;
        ctx.workerPool = workerPool;

        await wm.unmountProject(ctx.projectHash);

        expect(watcher.dispose).toHaveBeenCalledTimes(1);
        expect(workerPool.dispose).toHaveBeenCalledTimes(1);
        // Watcher stopped before the worker pool (and both before DB close).
        expect(order).toEqual(['watcher', 'workerPool']);
        expect(ctx.watcher).toBeUndefined();
        expect(ctx.workerPool).toBeUndefined();
    });

    it('closes the DB handle so the old connection is unusable after unmount', async () => {
        const wm = new WorkspaceManager();
        const ctx = await wm.mountProject(projectDir);
        await wm.initializeEngine(ctx.projectHash);

        const db = ctx.dbManager!.getDb();
        expect(db.open).toBe(true);

        await wm.unmountProject(ctx.projectHash);

        // The underlying better-sqlite3 handle is closed; touching it throws.
        expect(db.open).toBe(false);
        expect(() => db.prepare('SELECT 1').get()).toThrow();
    });

    it('re-initialization after unmount passes the dbManager guard and rebuilds the engine', async () => {
        const wm = new WorkspaceManager();
        const ctx = await wm.mountProject(projectDir);
        await wm.initializeEngine(ctx.projectHash);
        const firstDb = ctx.dbManager;

        await wm.unmountProject(ctx.projectHash);
        expect(ctx.dbManager).toBeUndefined();

        // Re-mount (idempotent — returns the same bare context) then re-init.
        const ctx2 = await wm.mountProject(projectDir);
        expect(ctx2).toBe(ctx);
        await wm.initializeEngine(ctx2.projectHash);

        // The `if (ctx.dbManager) return ctx` guard did NOT short-circuit:
        // a fresh, live engine was rebuilt.
        expect(ctx2.dbManager).toBeDefined();
        expect(ctx2.dbManager).not.toBe(firstDb);
        expect(ctx2.graphEngine).toBeDefined();
        expect(ctx2.dbManager!.getDb().open).toBe(true);
        expect(() => ctx2.dbManager!.getDb().prepare('SELECT 1').get()).not.toThrow();

        await wm.dispose();
    });

    it('with { remove: true } deletes the context entry and reassigns active project', async () => {
        const wm = new WorkspaceManager();
        const ctx = await wm.mountProject(projectDir);
        await wm.initializeEngine(ctx.projectHash);

        expect(wm.getActiveContext()).toBe(ctx);

        await wm.unmountProject(ctx.projectHash, { remove: true });

        expect(wm.getContextByHash(ctx.projectHash)).toBeUndefined();
        expect(wm.getActiveContext()).toBeNull();
    });

    it('is a no-op for an unknown hash', async () => {
        const wm = new WorkspaceManager();
        await expect(wm.unmountProject('does-not-exist')).resolves.toBeUndefined();
    });
});

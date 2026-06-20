import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Phase 13-3 (diagnostic-v10 H-1 / A-11) bootstrap-level lock guarantees.
 *
 * The failover / acquireAndRun / setOnInitialize logic lives inside the
 * monolithic bootstrap() closure and is not directly importable. These tests
 * instead pin the LockManager-level invariants that bootstrap relies on:
 *
 *   - H-1: a freshly acquired (or failover-promoted) Host that runs the
 *     heartbeat timer keeps its lock's heartbeat fresh (so it never looks
 *     stale to a peer's getValidLock + isHeartbeatStale check).
 *   - A-11: per-project lock identity — when a second LockManager targets the
 *     same project path, acquire() throws LockHeldError, which is exactly the
 *     signal bootstrap's setOnInitialize uses to demote (skip host services)
 *     instead of double-indexing.
 */

const TEST_LOCKS_DIR = path.join(os.tmpdir(), `cynapx-failover-test-${process.pid}`);
const TEST_STORAGE_DIR = path.join(os.tmpdir(), `cynapx-failover-storage-${process.pid}`);

vi.mock('../src/utils/paths', async (importOriginal) => {
    const original = await importOriginal<typeof import('../src/utils/paths')>();
    return {
        ...original,
        getLocksDir: () => {
            if (!fs.existsSync(TEST_LOCKS_DIR)) fs.mkdirSync(TEST_LOCKS_DIR, { recursive: true });
            return TEST_LOCKS_DIR;
        },
        getCentralStorageDir: () => {
            if (!fs.existsSync(TEST_STORAGE_DIR)) fs.mkdirSync(TEST_STORAGE_DIR, { recursive: true });
            return TEST_STORAGE_DIR;
        },
    };
});

import { LockManager, LockHeldError } from '../src/utils/lock-manager';

const PROJECT_A = path.join(os.tmpdir(), `cynapx-failover-projectA-${process.pid}`);
const PROJECT_B = path.join(os.tmpdir(), `cynapx-failover-projectB-${process.pid}`);

describe('bootstrap failover / project-lock invariants', () => {
    const managers: LockManager[] = [];

    afterEach(async () => {
        for (const m of managers) {
            try { await m.release(); } catch { /* ignore */ }
        }
        managers.length = 0;
        if (fs.existsSync(TEST_LOCKS_DIR)) {
            for (const f of fs.readdirSync(TEST_LOCKS_DIR)) {
                try { fs.unlinkSync(path.join(TEST_LOCKS_DIR, f)); } catch { /* ignore */ }
            }
        }
    });

    it('H-1: heartbeat keeps a Host lock fresh (not stale) — mirrors the promoted-Host timer', async () => {
        const host = new LockManager(PROJECT_A);
        managers.push(host);
        await host.acquire(5000, 'host-nonce');

        // Plant an old heartbeat to simulate the moment before the timer fires.
        const lockPath: string = (host as any).lockPath;
        const stalePast = new Date(Date.now() - 200_000).toISOString();
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        // currentLock.lastHeartbeat drives the next write; emulate staleness then
        // verify a heartbeat() (what the timer calls) makes it fresh again.
        (host as any).currentLock.lastHeartbeat = stalePast;
        expect(host.isHeartbeatStale({ ...lock, lastHeartbeat: stalePast })).toBe(true);

        await host.heartbeat();
        const refreshed = await host.getValidLock();
        expect(refreshed).not.toBeNull();
        expect(host.isHeartbeatStale(refreshed!)).toBe(false);
    });

    it('A-11: a second Host on the same project path is rejected with LockHeldError (demotion signal)', async () => {
        const first = new LockManager(PROJECT_A);
        managers.push(first);
        await first.acquire(6000, 'first');

        // A different process initializing the SAME project must be refused.
        const second = new LockManager(PROJECT_A);
        managers.push(second);
        await expect(second.acquire(6001, 'second')).rejects.toThrow(LockHeldError);

        // The original lock identity is intact (no double-ownership).
        const lockPath: string = (first as any).lockPath;
        const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        expect(data.nonce).toBe('first');
        expect(data.ipcPort).toBe(6000);
    });

    it('A-11: distinct project paths get independent locks (PENDING global vs project lock)', async () => {
        const global = new LockManager(PROJECT_A);
        const project = new LockManager(PROJECT_B);
        managers.push(global, project);

        // Both acquire successfully because they key on different project paths.
        await global.acquire(7000, 'global');
        await project.acquire(7001, 'project');

        const globalPath: string = (global as any).lockPath;
        const projectPath: string = (project as any).lockPath;
        expect(globalPath).not.toBe(projectPath);
        expect(JSON.parse(fs.readFileSync(globalPath, 'utf8')).nonce).toBe('global');
        expect(JSON.parse(fs.readFileSync(projectPath, 'utf8')).nonce).toBe('project');
    });
});

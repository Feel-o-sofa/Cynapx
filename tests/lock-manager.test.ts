import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

/**
 * Tests for LockManager.
 *
 * LockManager uses getLocksDir() from paths.ts which writes to ~/.cynapx/locks/.
 * To avoid touching the real home directory during tests, we mock the paths module
 * so locks go to a temporary directory.
 */

// We need to intercept the `paths` module before importing LockManager.
// Use vi.mock to redirect getLocksDir and getProjectHash to a temp dir.
const TEST_LOCKS_DIR = path.join(os.tmpdir(), `cynapx-lock-test-${process.pid}`);
const TEST_STORAGE_DIR = path.join(os.tmpdir(), `cynapx-lock-storage-${process.pid}`);
const TEST_PROJECT_PATH = path.join(os.tmpdir(), `cynapx-lock-project-${process.pid}`);

vi.mock('../src/utils/paths', async (importOriginal) => {
    const original = await importOriginal<typeof import('../src/utils/paths')>();
    return {
        ...original,
        getLocksDir: () => {
            if (!fs.existsSync(TEST_LOCKS_DIR)) {
                fs.mkdirSync(TEST_LOCKS_DIR, { recursive: true });
            }
            return TEST_LOCKS_DIR;
        },
        getCentralStorageDir: () => {
            if (!fs.existsSync(TEST_STORAGE_DIR)) {
                fs.mkdirSync(TEST_STORAGE_DIR, { recursive: true });
            }
            return TEST_STORAGE_DIR;
        },
    };
});

import {
    LockManager,
    LockHeldError,
    HEARTBEAT_STALE_MS,
    CONNECT_MAX_RETRIES,
    decideConnectFailureAction,
} from '../src/utils/lock-manager';

describe('LockManager', () => {
    let manager: LockManager;

    afterEach(async () => {
        // Clean up: release any acquired lock and remove test lock files
        if (manager) {
            await manager.release();
        }
        // Remove all lock files in the test locks dir
        if (fs.existsSync(TEST_LOCKS_DIR)) {
            for (const f of fs.readdirSync(TEST_LOCKS_DIR)) {
                try { fs.unlinkSync(path.join(TEST_LOCKS_DIR, f)); } catch {}
            }
        }
        // Remove all DB/journal files in the test storage dir
        if (fs.existsSync(TEST_STORAGE_DIR)) {
            for (const f of fs.readdirSync(TEST_STORAGE_DIR)) {
                try { fs.unlinkSync(path.join(TEST_STORAGE_DIR, f)); } catch {}
            }
        }
    });

    describe('lock file path construction', () => {
        it('should use path.sep in lock path construction (cross-platform fix)', () => {
            // The fix ensures path.sep is used rather than a hardcoded '/'
            // We verify the lockPath is a properly joined OS path
            manager = new LockManager(TEST_PROJECT_PATH);
            // Access lockPath via private field (we cast to any for testing)
            const lockPath: string = (manager as any).lockPath;
            // The lock path must be inside TEST_LOCKS_DIR and end with .lock
            expect(lockPath.startsWith(TEST_LOCKS_DIR)).toBe(true);
            expect(lockPath.endsWith('.lock')).toBe(true);
            // Ensure path.join was used (no mixed separators on Windows)
            if (process.platform === 'win32') {
                expect(lockPath).not.toContain('/');  // On Windows all separators should be backslashes
            } else {
                expect(lockPath).not.toContain('\\');  // On POSIX all separators should be forward slashes
            }
        });
    });

    describe('acquire and release', () => {
        it('should create a lock file on acquire', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(12345);

            const lockPath: string = (manager as any).lockPath;
            expect(fs.existsSync(lockPath)).toBe(true);
        });

        it('should write correct lock info to the lock file', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(9999);

            const lockPath: string = (manager as any).lockPath;
            const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

            expect(data.pid).toBe(process.pid);
            expect(data.ipcPort).toBe(9999);
            expect(data.status).toBe('active');
            expect(typeof data.lastHeartbeat).toBe('string');
        });

        it('should remove the lock file on release', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(12345);
            await manager.release();

            const lockPath: string = (manager as any).lockPath;
            expect(fs.existsSync(lockPath)).toBe(false);
        });

        it('should set currentLock to null after release', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(12345);
            await manager.release();

            expect((manager as any).currentLock).toBeNull();
        });
    });

    describe('atomic acquire (H-4)', () => {
        it('should throw LockHeldError when another live process holds the lock', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const lockPath: string = (manager as any).lockPath;

            // Simulate a lock held by another live process (use our own PID,
            // which is guaranteed to be alive, but a different "process").
            const liveLock = {
                pid: process.pid,
                ipcPort: 4242,
                lastHeartbeat: new Date().toISOString(),
                status: 'active',
                nonce: 'other-process-nonce',
            };
            fs.writeFileSync(lockPath, JSON.stringify(liveLock, null, 2), 'utf8');

            await expect(manager.acquire(9999, 'my-nonce')).rejects.toThrow(LockHeldError);

            try {
                await manager.acquire(9999, 'my-nonce');
            } catch (err) {
                expect(err).toBeInstanceOf(LockHeldError);
                expect((err as LockHeldError).lock.ipcPort).toBe(4242);
            }

            // currentLock must remain unset since acquisition failed.
            expect((manager as any).currentLock).toBeNull();

            // The other process's lock file must be left untouched.
            const onDisk = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            expect(onDisk.ipcPort).toBe(4242);

            // Manually clear the lock file so afterEach's release() (which is a
            // no-op since currentLock is null) doesn't leave it behind.
            fs.unlinkSync(lockPath);
        });

        it('should clean up a stale lock (dead PID) and acquire successfully', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const lockPath: string = (manager as any).lockPath;

            const staleLock = {
                pid: 2147483647,
                ipcPort: 1234,
                lastHeartbeat: new Date().toISOString(),
                status: 'active',
                nonce: 'stale-nonce',
            };
            fs.writeFileSync(lockPath, JSON.stringify(staleLock, null, 2), 'utf8');

            await manager.acquire(8888, 'fresh-nonce');

            const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            expect(data.pid).toBe(process.pid);
            expect(data.ipcPort).toBe(8888);
            expect(data.nonce).toBe('fresh-nonce');
        });

        it('should not allow a second acquire to overwrite an existing live lock (no TOCTOU)', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(1111, 'first-nonce');

            const other = new LockManager(TEST_PROJECT_PATH);
            await expect(other.acquire(2222, 'second-nonce')).rejects.toThrow(LockHeldError);

            // Original lock must remain intact.
            const lockPath: string = (manager as any).lockPath;
            const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            expect(data.ipcPort).toBe(1111);
            expect(data.nonce).toBe('first-nonce');
        });
    });

    describe('getValidLock', () => {
        it('should return null when no lock file exists', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const lock = await manager.getValidLock();
            expect(lock).toBeNull();
        });

        it('should return the lock info for the current process (active PID)', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(7777);

            const lock = await manager.getValidLock();
            expect(lock).not.toBeNull();
            expect(lock!.pid).toBe(process.pid);
            expect(lock!.ipcPort).toBe(7777);
            expect(lock!.status).toBe('active');
        });

        it('should detect and remove a stale lock (dead PID)', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            // Write a lock file with a PID that is guaranteed to not exist
            // PID 2147483647 (max int) is virtually never a real process
            const lockPath: string = (manager as any).lockPath;
            const staleLock = {
                pid: 2147483647,
                ipcPort: 1234,
                lastHeartbeat: new Date().toISOString(),
                status: 'active',
            };
            fs.writeFileSync(lockPath, JSON.stringify(staleLock, null, 2), 'utf8');

            const result = await manager.getValidLock();
            expect(result).toBeNull();
            // The stale lock file should have been removed
            expect(fs.existsSync(lockPath)).toBe(false);
        });

        it('should return null and remove corrupted lock file', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const lockPath: string = (manager as any).lockPath;
            fs.writeFileSync(lockPath, 'not-valid-json', 'utf8');

            const result = await manager.getValidLock();
            expect(result).toBeNull();
            expect(fs.existsSync(lockPath)).toBe(false);
        });

        it('should preserve the main DB file (and checkpoint WAL) when cleaning up a stale lock (C-1 regression)', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const lockPath: string = (manager as any).lockPath;
            const lockHash = path.basename(lockPath, '.lock');

            // Set up a real SQLite DB in WAL mode with a pending WAL file,
            // mirroring the on-disk state left by a crashed host process.
            const dbFile = path.join(TEST_STORAGE_DIR, `${lockHash}_v2.db`);
            const db = new Database(dbFile);
            db.pragma('journal_mode = WAL');
            db.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, value TEXT)');
            db.prepare('INSERT INTO marker (value) VALUES (?)').run('committed-before-crash');
            db.close();
            expect(fs.existsSync(dbFile)).toBe(true);

            // Write a stale lock referencing a dead PID.
            const staleLock = {
                pid: 2147483647,
                ipcPort: 1234,
                lastHeartbeat: new Date().toISOString(),
                status: 'active',
                nonce: 'stale-nonce',
            };
            fs.writeFileSync(lockPath, JSON.stringify(staleLock, null, 2), 'utf8');

            const result = await manager.getValidLock();
            expect(result).toBeNull();

            // The DB file itself must survive cleanup, with its data intact.
            expect(fs.existsSync(dbFile)).toBe(true);
            const verifyDb = new Database(dbFile, { readonly: true });
            const row = verifyDb.prepare('SELECT value FROM marker').get() as { value: string };
            expect(row.value).toBe('committed-before-crash');
            verifyDb.close();
        });
    });

    describe('heartbeat', () => {
        it('should update lastHeartbeat in the lock file', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(5555);

            const lockPath: string = (manager as any).lockPath;
            const before = JSON.parse(fs.readFileSync(lockPath, 'utf8')).lastHeartbeat;

            // Wait a millisecond to ensure timestamp differs
            await new Promise(r => setTimeout(r, 5));
            await manager.heartbeat();

            const after = JSON.parse(fs.readFileSync(lockPath, 'utf8')).lastHeartbeat;
            expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
        });

        it('should be a no-op when no lock is held', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            // Should not throw
            await expect(manager.heartbeat()).resolves.toBeUndefined();
        });
    });

    describe('signalShutdown', () => {
        it('should set status to shutting-down in the lock file', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(4444);
            await manager.signalShutdown();

            const lockPath: string = (manager as any).lockPath;
            const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            expect(data.status).toBe('shutting-down');
        });
    });

    // H-2 (diagnostic-v10): heartbeat/signalShutdown must be atomic (tmp+rename)
    // so a concurrent reader never observes a truncated/partial JSON and
    // mistakes a live lock for a corrupt one (which previously triggered an
    // immediate delete → split-brain).
    describe('H-2: atomic heartbeat write', () => {
        it('should never leave a partial/corrupt lock file under concurrent heartbeat + getValidLock', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(6000, 'atomic-nonce');
            const lockPath: string = (manager as any).lockPath;

            let corruptObservations = 0;
            // Hammer heartbeat() and getValidLock() interleaved. Because the
            // write is atomic, getValidLock must always read complete JSON and
            // return a live lock — never null from a parse failure.
            for (let i = 0; i < 100; i++) {
                const hb = manager.heartbeat();
                const got = await manager.getValidLock();
                await hb;
                if (got === null) corruptObservations++;
            }
            expect(corruptObservations).toBe(0);

            // The final on-disk file must be valid JSON with our nonce.
            const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            expect(data.nonce).toBe('atomic-nonce');

            // No leftover .tmp files in the locks dir.
            const tmpFiles = fs.readdirSync(TEST_LOCKS_DIR).filter(f => f.includes('.tmp'));
            expect(tmpFiles).toHaveLength(0);
        });

        it('should retry once on a transient partial read before deleting the lock', async () => {
            // Simulate a partial write: the file initially contains truncated
            // JSON, then is completed (atomic replace) during getValidLock's
            // ~50ms retry sleep. The lock must survive the retry, not be deleted.
            manager = new LockManager(TEST_PROJECT_PATH);
            const lockPath: string = (manager as any).lockPath;

            // Start with truncated JSON so the first parse fails.
            fs.writeFileSync(lockPath, '{ "pid": 123, "ipcPo', 'utf8');

            const validLock = {
                pid: process.pid,
                ipcPort: 6001,
                lastHeartbeat: new Date().toISOString(),
                status: 'active',
                nonce: 'retry-nonce',
            };
            // Complete the write shortly after, before the retry reread (50ms).
            const t = setTimeout(() => {
                fs.writeFileSync(lockPath, JSON.stringify(validLock, null, 2), 'utf8');
            }, 20);

            const result = await manager.getValidLock();
            clearTimeout(t);

            // After the retry read returned valid JSON for a live PID, the lock
            // must be preserved (not deleted).
            expect(result).not.toBeNull();
            expect(result!.nonce).toBe('retry-nonce');
            expect(fs.existsSync(lockPath)).toBe(true);
        });
    });

    // H-2: release() must verify the on-disk lock still belongs to us (same
    // nonce) before unlinking — otherwise it could delete a foreign Host's lock
    // installed after a failover replacement.
    describe('H-2: release self-nonce verification', () => {
        it('should NOT delete a lock that was overwritten by another nonce', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(6100, 'mine');
            const lockPath: string = (manager as any).lockPath;

            // Simulate another Host replacing the lock file (different nonce).
            const foreign = {
                pid: process.pid,
                ipcPort: 6101,
                lastHeartbeat: new Date().toISOString(),
                status: 'active',
                nonce: 'foreign',
            };
            fs.writeFileSync(lockPath, JSON.stringify(foreign, null, 2), 'utf8');

            await manager.release();

            // Foreign lock must survive untouched.
            expect(fs.existsSync(lockPath)).toBe(true);
            const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            expect(data.nonce).toBe('foreign');

            fs.unlinkSync(lockPath);
        });

        it('should delete its own lock on release when the nonce still matches', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            await manager.acquire(6200, 'self');
            const lockPath: string = (manager as any).lockPath;

            await manager.release();
            expect(fs.existsSync(lockPath)).toBe(false);
        });
    });

    // H-1 (diagnostic-v10): heartbeat-age-based staleness detection. PID
    // liveness alone is insufficient because a reused PID makes a dead Host's
    // lock look valid forever.
    describe('H-1: heartbeat-age staleness', () => {
        it('isHeartbeatStale returns false for a fresh heartbeat', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const lock = {
                pid: process.pid,
                ipcPort: 7000,
                lastHeartbeat: new Date().toISOString(),
                status: 'active' as const,
                nonce: 'fresh',
            };
            expect(manager.isHeartbeatStale(lock)).toBe(false);
        });

        it('isHeartbeatStale returns true when heartbeat age exceeds the threshold', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const old = new Date(Date.now() - (HEARTBEAT_STALE_MS + 5000)).toISOString();
            const lock = {
                pid: process.pid,
                ipcPort: 7001,
                lastHeartbeat: old,
                status: 'active' as const,
                nonce: 'old',
            };
            expect(manager.isHeartbeatStale(lock)).toBe(true);
        });

        it('isHeartbeatStale returns true for a missing/invalid heartbeat', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const lock = {
                pid: process.pid,
                ipcPort: 7002,
                lastHeartbeat: 'not-a-date',
                status: 'active' as const,
                nonce: 'bad',
            };
            expect(manager.isHeartbeatStale(lock)).toBe(true);
        });

        it('getValidLock still returns a live lock with a stale heartbeat (staleness is advisory, combined with connect failure by the caller)', async () => {
            // PID-reuse simulation: the PID is alive (our own), but the heartbeat
            // is ancient. getValidLock must NOT delete it on its own — the
            // reclamation decision belongs to bootstrap (connect failure +
            // stale heartbeat). This documents the contract H-1 relies on.
            manager = new LockManager(TEST_PROJECT_PATH);
            const lockPath: string = (manager as any).lockPath;
            const stale = {
                pid: process.pid, // alive
                ipcPort: 7003,
                lastHeartbeat: new Date(Date.now() - (HEARTBEAT_STALE_MS + 10000)).toISOString(),
                status: 'active',
                nonce: 'reused-pid',
            };
            fs.writeFileSync(lockPath, JSON.stringify(stale, null, 2), 'utf8');

            const result = await manager.getValidLock();
            expect(result).not.toBeNull();
            expect(manager.isHeartbeatStale(result!)).toBe(true);
            // File preserved (not auto-deleted by getValidLock).
            expect(fs.existsSync(lockPath)).toBe(true);

            fs.unlinkSync(lockPath);
        });
    });

    // H-1: forceReclaim removes a stale lock only if its nonce still matches the
    // observed one (guards against deleting a fresh replacement).
    describe('H-1: forceReclaim', () => {
        it('reclaims a stale lock when the nonce matches', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const lockPath: string = (manager as any).lockPath;
            fs.writeFileSync(lockPath, JSON.stringify({
                pid: 999999, ipcPort: 7100, lastHeartbeat: new Date().toISOString(),
                status: 'active', nonce: 'doomed',
            }, null, 2), 'utf8');

            const reclaimed = manager.forceReclaim('doomed');
            expect(reclaimed).toBe(true);
            expect(fs.existsSync(lockPath)).toBe(false);
        });

        it('refuses to reclaim when a different nonce now owns the lock', async () => {
            manager = new LockManager(TEST_PROJECT_PATH);
            const lockPath: string = (manager as any).lockPath;
            fs.writeFileSync(lockPath, JSON.stringify({
                pid: process.pid, ipcPort: 7101, lastHeartbeat: new Date().toISOString(),
                status: 'active', nonce: 'newowner',
            }, null, 2), 'utf8');

            const reclaimed = manager.forceReclaim('oldowner');
            expect(reclaimed).toBe(false);
            expect(fs.existsSync(lockPath)).toBe(true);

            fs.unlinkSync(lockPath);
        });
    });

    // H-1: connect-failure escalation policy used by acquireAndRun to cap the
    // unbounded 2s retry loop.
    describe('H-1: decideConnectFailureAction (retry cap)', () => {
        it('retries while under the cap with a fresh heartbeat', () => {
            for (let r = 1; r < CONNECT_MAX_RETRIES; r++) {
                expect(decideConnectFailureAction(false, r)).toBe('retry');
            }
        });

        it('reclaims immediately when the heartbeat is stale (PID reuse), even on the first failure', () => {
            expect(decideConnectFailureAction(true, 1)).toBe('reclaim');
        });

        it('reclaims once the retry cap is reached even with a fresh heartbeat', () => {
            expect(decideConnectFailureAction(false, CONNECT_MAX_RETRIES)).toBe('reclaim');
            expect(decideConnectFailureAction(false, CONNECT_MAX_RETRIES + 1)).toBe('reclaim');
        });

        it('does not loop forever — every retry count eventually escalates to reclaim', () => {
            let action: 'reclaim' | 'retry' = 'retry';
            let retries = 0;
            // Simulate the bootstrap loop with a fresh (non-stale) heartbeat.
            while (action === 'retry' && retries < 1000) {
                retries++;
                action = decideConnectFailureAction(false, retries);
            }
            expect(action).toBe('reclaim');
            expect(retries).toBe(CONNECT_MAX_RETRIES);
        });
    });
});

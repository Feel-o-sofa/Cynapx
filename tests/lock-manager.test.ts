import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    };
});

import { LockManager } from '../src/utils/lock-manager';

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
            expect(lockPath).not.toContain('/');  // On Windows all should be backslashes
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
});

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 13-6 (A-9): admin CLI safe lifecycle operations.
 *
 * Covers the two load-bearing primitives the admin CLI's destructive commands
 * (purge / compact / restore) and `backup` are built on:
 *   - LockManager.probeProjectLock(): the read-only liveness check the
 *     refuse-on-live-Host guard uses (reused from Phase 13-3, NOT reimplemented
 *     in admin.ts), and
 *   - VACUUM INTO online backup producing a consistent, openable SQLite file
 *     that passes PRAGMA integrity_check.
 *
 * The end-to-end CLI refuse path (live lock -> refuse unless --force) is also
 * exercised against the built CLI in scripts/integration-test.js.
 *
 * HOME is stubbed so the lock dir (~/.cynapx/locks) lives inside the sandbox.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { LockManager } from '../src/utils/lock-manager';
import { getLocksDir, getProjectHash } from '../src/utils/paths';

let fakeHome: string;
let projectDir: string;

function writeLock(projectPath: string, lock: {
    pid: number; ipcPort?: number; lastHeartbeat?: string; status?: string; nonce?: string;
}): string {
    const hash = getProjectHash(projectPath);
    const lockPath = path.join(getLocksDir(), `${hash}.lock`);
    fs.writeFileSync(lockPath, JSON.stringify({
        pid: lock.pid,
        ipcPort: lock.ipcPort ?? 12345,
        lastHeartbeat: lock.lastHeartbeat ?? new Date().toISOString(),
        status: lock.status ?? 'active',
        nonce: lock.nonce ?? 'deadbeef',
    }));
    return lockPath;
}

beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-admin-home-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-admin-proj-'));
    vi.stubEnv('HOME', fakeHome);
    vi.stubEnv('USERPROFILE', fakeHome);
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('LockManager.probeProjectLock (A-9 refuse-on-live-Host primitive)', () => {
    it('returns null when no lock file exists', () => {
        expect(LockManager.probeProjectLock(projectDir)).toBeNull();
    });

    it('returns the lock when a live PID holds it with a fresh heartbeat', () => {
        writeLock(projectDir, { pid: process.pid, lastHeartbeat: new Date().toISOString() });
        const lock = LockManager.probeProjectLock(projectDir);
        expect(lock).not.toBeNull();
        expect(lock!.pid).toBe(process.pid);
    });

    it('returns null when the recorded PID is dead', () => {
        // PID 1 is init/cannot be signalled by us in most sandboxes; use a very
        // high PID that is essentially guaranteed not to exist.
        const deadPid = 2 ** 22; // 4194304 — above typical pid_max
        writeLock(projectDir, { pid: deadPid });
        expect(LockManager.probeProjectLock(projectDir)).toBeNull();
    });

    it('returns null when the heartbeat is stale even if the PID is alive', () => {
        const old = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago > 90s
        writeLock(projectDir, { pid: process.pid, lastHeartbeat: old });
        expect(LockManager.probeProjectLock(projectDir)).toBeNull();
    });

    it('returns null for an unparseable lock file', () => {
        const hash = getProjectHash(projectDir);
        fs.writeFileSync(path.join(getLocksDir(), `${hash}.lock`), '{ not json');
        expect(LockManager.probeProjectLock(projectDir)).toBeNull();
    });

    it('is read-only: never deletes the lock file it observes', () => {
        const lockPath = writeLock(projectDir, { pid: process.pid });
        LockManager.probeProjectLock(projectDir);
        expect(fs.existsSync(lockPath)).toBe(true);
    });
});

describe('VACUUM INTO online backup (A-9 backup mechanism)', () => {
    function makeSourceDb(dbPath: string): void {
        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
        const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
        for (let i = 0; i < 50; i++) insert.run(`row-${i}`);
        // Leave the WAL un-checkpointed to simulate a live DB.
        db.close();
    }

    it('produces a single openable file that passes PRAGMA integrity_check', () => {
        const srcDb = path.join(projectDir, 'src_v2.db');
        const destDb = path.join(projectDir, 'backup.db');
        makeSourceDb(srcDb);

        const src = new Database(srcDb, { readonly: true, fileMustExist: true });
        try {
            if (fs.existsSync(destDb)) fs.unlinkSync(destDb);
            src.prepare('VACUUM INTO ?').run(destDb);
        } finally {
            src.close();
        }

        expect(fs.existsSync(destDb)).toBe(true);
        // The backup carries no -wal/-shm sidecars (self-contained snapshot).
        expect(fs.existsSync(`${destDb}-wal`)).toBe(false);

        const backup = new Database(destDb, { readonly: true, fileMustExist: true });
        try {
            const integrity = backup.pragma('integrity_check', { simple: true });
            expect(integrity).toBe('ok');
            const count = (backup.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }).c;
            expect(count).toBe(50);
        } finally {
            backup.close();
        }
    });
});

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { getLocksDir, getProjectHash, getCentralStorageDir } from './paths';

export interface LockInfo {
    pid: number;
    ipcPort: number;
    lastHeartbeat: string;
    status: 'active' | 'shutting-down';
    nonce: string;
}

/**
 * Heartbeat age (ms) beyond which a lock is considered *potentially* stale even
 * though its PID is still alive. The Host writes a heartbeat every 30s
 * (bootstrap.ts), so 90s tolerates two missed beats before suspicion. A lock is
 * only reclaimed when this age is exceeded AND the IPC connection cannot be
 * established (the connect check lives in bootstrap.ts, where the IPC layer is
 * available) — this defends against PID reuse making a dead Host's lock look
 * valid forever.
 */
export const HEARTBEAT_STALE_MS = 90_000;

/**
 * H-1: maximum number of consecutive failed connect attempts a Terminal makes
 * to a recorded Host before it escalates to stale-lock reclamation. Without a
 * cap, a dead Host whose PID was reused keeps the lock "valid" forever and the
 * Terminal retries every 2s indefinitely, never becoming ready.
 */
export const CONNECT_MAX_RETRIES = 5;

/**
 * H-1: pure decision for what acquireAndRun should do after a connect attempt
 * to the recorded Host fails. Extracted so the escalation policy is unit
 * testable independently of the bootstrap closure / IPC layer.
 *
 * - `reclaim`: heartbeat is stale (PID likely reused / Host dead) OR the retry
 *   cap was reached — forcibly reclaim the lock and re-run acquisition.
 * - `retry`: under the cap with a still-fresh heartbeat — back off and retry
 *   the connect.
 */
export function decideConnectFailureAction(
    heartbeatStale: boolean,
    retries: number,
    maxRetries: number = CONNECT_MAX_RETRIES,
): 'reclaim' | 'retry' {
    if (heartbeatStale) return 'reclaim';
    if (retries >= maxRetries) return 'reclaim';
    return 'retry';
}

/**
 * Thrown by LockManager.acquire() when another live process already holds
 * the lock. Callers should fall back to connecting to that host instead.
 */
export class LockHeldError extends Error {
    constructor(public readonly lock: LockInfo) {
        super(`Lock already held by PID ${lock.pid} (ipcPort=${lock.ipcPort})`);
        this.name = 'LockHeldError';
    }
}

/**
 * Manages project-specific session locks to ensure a single host per project.
 */
export class LockManager {
    private lockPath: string;
    private currentLock: LockInfo | null = null;

    constructor(projectPath: string) {
        const hash = getProjectHash(projectPath);
        this.lockPath = path.join(getLocksDir(), `${hash}.lock`);
    }

    /**
     * A-9: Read-only liveness probe for a project's lock, reusing the same
     * PID-liveness + heartbeat-staleness primitives the Host uses, so admin
     * tooling never reimplements that policy. Unlike {@link getValidLock} this
     * has NO side effects (never deletes/cleans up the lock file) — admin CLI
     * must only *observe*, never mutate, another process's lock.
     *
     * Returns the live lock info if a process owns the lock and is reachable
     * (PID alive AND heartbeat fresh), otherwise null (no lock / dead PID /
     * stale heartbeat / unparseable file).
     */
    public static probeProjectLock(projectPath: string): LockInfo | null {
        const hash = getProjectHash(projectPath);
        const lockPath = path.join(getLocksDir(), `${hash}.lock`);
        if (!fs.existsSync(lockPath)) return null;
        let lock: LockInfo;
        try {
            lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LockInfo;
        } catch {
            return null;
        }
        // PID liveness (process.kill(pid, 0) throws ESRCH for a dead process).
        try {
            process.kill(lock.pid, 0);
        } catch {
            return null;
        }
        // Heartbeat freshness — a stale heartbeat (with PID possibly reused)
        // means the recorded Host is not actually live.
        const ts = Date.parse(lock.lastHeartbeat);
        if (Number.isNaN(ts) || Date.now() - ts > HEARTBEAT_STALE_MS) {
            return null;
        }
        return lock;
    }

    /**
     * Checks if a valid lock exists for the project.
     * Returns the lock info if it exists and the process is alive.
     * Automatically cleans up stale locks and residual DB journal files.
     */
    public async getValidLock(): Promise<LockInfo | null> {
        if (!fs.existsSync(this.lockPath)) {
            return null;
        }

        try {
            const data = fs.readFileSync(this.lockPath, 'utf8');
            const lock: LockInfo = JSON.parse(data);

            // Check if process is alive
            try {
                process.kill(lock.pid, 0);
                return lock;
            } catch (e: any) {
                // PID is dead — but re-read to guard against TOCTOU
                console.error(`[*] Stale lock detected (PID ${lock.pid} is dead). Cleaning up residual files...`);

                try {
                    const recheck = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as LockInfo;
                    if (recheck.nonce !== lock.nonce) {
                        // Another process overwrote the lock — it's no longer stale
                        return recheck;
                    }
                } catch {
                    // File was already deleted or is corrupted — proceed with cleanup
                }

                // 1. Remove the lock file itself
                if (fs.existsSync(this.lockPath)) fs.unlinkSync(this.lockPath);

                // 2. Flush and clear residual WAL/SHM journal files that might keep the
                // DB locked. The main DB file is NEVER deleted here — it holds the
                // index data; deleting it would discard the entire project index.
                // SEC-H-4: use getCentralStorageDir() for correct DB path (~/.cynapx/<hash>_v2.db)
                // lockPath = ~/.cynapx/locks/<hash>.lock → hash = basename without extension
                const lockHash = path.basename(this.lockPath, '.lock');
                const dbFile = path.join(getCentralStorageDir(), `${lockHash}_v2.db`);

                if (fs.existsSync(dbFile)) {
                    // Checkpoint the WAL into the main DB before removing journal files,
                    // so any commits from the crashed process are not lost.
                    try {
                        const db = new Database(dbFile);
                        try {
                            db.pragma('wal_checkpoint(TRUNCATE)');
                        } finally {
                            db.close();
                        }
                    } catch (err) {
                        console.error(`[!] Failed to checkpoint WAL for ${dbFile}: ${err}`);
                    }
                }

                ['-wal', '-shm'].forEach(suffix => {
                    const file = `${dbFile}${suffix}`;
                    if (fs.existsSync(file)) {
                        try { fs.unlinkSync(file); } catch(err) { console.error(`[!] Failed to delete ${file}: ${err}`); }
                    }
                });

                return null;
            }
        } catch (err) {
            // H-2: a concurrent in-place heartbeat write could let a reader
            // observe truncated/partial JSON. Deleting the lock immediately on a
            // single failed parse causes split-brain (another process then
            // acquires the same lock). Retry once after a short delay + reread
            // before concluding the file is genuinely corrupt; a transient
            // partial write will have been completed by then.
            await new Promise(r => setTimeout(r, 50));
            if (!fs.existsSync(this.lockPath)) {
                return null;
            }
            try {
                const retryData = fs.readFileSync(this.lockPath, 'utf8');
                const retryLock: LockInfo = JSON.parse(retryData);
                // Re-run liveness on the recovered lock.
                try {
                    process.kill(retryLock.pid, 0);
                    return retryLock;
                } catch {
                    // PID dead — fall through to genuine cleanup below.
                }
            } catch {
                // Still unparseable after the retry — treat as genuinely corrupt.
            }
            if (fs.existsSync(this.lockPath)) fs.unlinkSync(this.lockPath);
            return null;
        }
    }

    /**
     * H-1: Returns true when the lock's heartbeat is older than
     * {@link HEARTBEAT_STALE_MS}. A stale heartbeat alone does NOT prove the
     * Host is dead (the timer may be briefly starved); callers should combine
     * this with an IPC connection failure before reclaiming the lock.
     */
    public isHeartbeatStale(lock: LockInfo): boolean {
        const ts = Date.parse(lock.lastHeartbeat);
        if (Number.isNaN(ts)) {
            // Missing/invalid heartbeat — treat as stale.
            return true;
        }
        return Date.now() - ts > HEARTBEAT_STALE_MS;
    }

    /**
     * H-1: Forcibly reclaims a lock that the caller has determined to be stale
     * (e.g. heartbeat age exceeded AND IPC connect failed). Only removes the
     * file if it still carries the same nonce we observed — guarding against
     * deleting a lock that a legitimate new Host has meanwhile installed.
     */
    public forceReclaim(expectedNonce: string): boolean {
        if (!fs.existsSync(this.lockPath)) return false;
        try {
            const onDisk = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as LockInfo;
            if (onDisk.nonce !== expectedNonce) {
                // A different Host now owns the lock — do not touch it.
                return false;
            }
        } catch {
            // Unparseable — fall through and remove it.
        }
        try {
            fs.unlinkSync(this.lockPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Attempts to acquire the lock atomically.
     *
     * Uses `fs.openSync(path, 'wx')` so the lock file is only created if it
     * does not already exist (O_EXCL), eliminating the TOCTOU window between
     * a prior `getValidLock()` check and the write. If the file already
     * exists, `getValidLock()` is consulted: a stale lock is cleaned up and
     * the create is retried once; a live lock causes a `LockHeldError` to be
     * thrown so the caller can fall back to Terminal mode.
     *
     * @param ipcPort - The IPC port the Host is listening on.
     * @param nonce - Session nonce generated before starting the IPC server; stored so
     *                Terminal sessions can read it and respond to the challenge.
     */
    public async acquire(ipcPort: number, nonce: string): Promise<void> {
        const lock: LockInfo = {
            pid: process.pid,
            ipcPort,
            lastHeartbeat: new Date().toISOString(),
            status: 'active',
            nonce,
        };
        const data = JSON.stringify(lock, null, 2);

        if (this.tryCreateLockFile(data)) {
            this.currentLock = lock;
            return;
        }

        // Lock file already exists — determine whether it's stale.
        const existing = await this.getValidLock();
        if (existing) {
            throw new LockHeldError(existing);
        }

        // getValidLock() removed the stale lock file; retry once.
        if (this.tryCreateLockFile(data)) {
            this.currentLock = lock;
            return;
        }

        // Another process won the race in between; report it.
        const winner = await this.getValidLock();
        if (winner) {
            throw new LockHeldError(winner);
        }
        throw new Error(`Failed to acquire lock at ${this.lockPath}`);
    }

    /**
     * Attempts to create the lock file with O_EXCL semantics.
     * Returns true on success, false if the file already exists.
     */
    private tryCreateLockFile(data: string): boolean {
        try {
            const fd = fs.openSync(this.lockPath, 'wx', 0o600);
            try {
                fs.writeFileSync(fd, data, 'utf8');
            } finally {
                fs.closeSync(fd);
            }
            return true;
        } catch (err: any) {
            if (err.code === 'EEXIST') return false;
            throw err;
        }
    }

    /**
     * H-2: Atomically replaces the lock file's contents.
     *
     * Writes to a unique temp file in the same directory, then `renameSync`s it
     * over the live lock path. rename is atomic on POSIX and Windows, so a
     * concurrent reader's `getValidLock()` always observes either the old or the
     * new complete JSON — never a truncated/partial in-place write. This closes
     * the split-brain window where a partial heartbeat write was misread as a
     * corrupt lock and deleted.
     *
     * The temp file is suffixed with the writer's pid + a random token so two
     * processes never collide on the same temp path.
     */
    private atomicWrite(data: string): void {
        const tmpPath = `${this.lockPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        try {
            fs.writeFileSync(tmpPath, data, { encoding: 'utf8', mode: 0o600 });
            fs.renameSync(tmpPath, this.lockPath);
        } catch (err) {
            // Best-effort cleanup of the temp file if the rename failed.
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
            throw err;
        }
    }

    /**
     * Updates the heartbeat of the current lock.
     */
    public async heartbeat(): Promise<void> {
        if (!this.currentLock) return;
        this.currentLock.lastHeartbeat = new Date().toISOString();
        this.atomicWrite(JSON.stringify(this.currentLock, null, 2));
    }

    /**
     * Releases the lock.
     *
     * H-2: only unlinks the on-disk lock file if it still belongs to us (same
     * nonce). After a failover replacement the on-disk lock may have been
     * overwritten by another Host; unlinking it unconditionally would delete a
     * live foreign lock and cause split-brain.
     */
    public async release(): Promise<void> {
        if (this.currentLock && this.currentLock.pid === process.pid) {
            if (fs.existsSync(this.lockPath)) {
                let owned = false;
                try {
                    const onDisk = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')) as LockInfo;
                    owned = onDisk.nonce === this.currentLock.nonce;
                } catch {
                    // Unparseable on-disk lock — could be our own half-written
                    // file from a crash. We only own it if no other identity is
                    // discernible; be conservative and remove it only when our
                    // nonce is undefined-safe. Treat unparseable as not-owned to
                    // avoid clobbering a foreign replacement.
                    owned = false;
                }
                if (owned) {
                    try { fs.unlinkSync(this.lockPath); } catch { /* already gone */ }
                }
            }
            this.currentLock = null;
        }
    }

    /**
     * Sets the status to shutting-down to signal Terminals for handover.
     */
    public async signalShutdown(): Promise<void> {
        if (this.currentLock) {
            this.currentLock.status = 'shutting-down';
            this.atomicWrite(JSON.stringify(this.currentLock, null, 2));
        }
    }
}

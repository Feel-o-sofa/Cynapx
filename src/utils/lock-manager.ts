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
            if (fs.existsSync(this.lockPath)) fs.unlinkSync(this.lockPath);
            return null;
        }
    }

    /**
     * Attempts to acquire the lock.
     * @param ipcPort - The IPC port the Host is listening on.
     * @param nonce - Session nonce generated before starting the IPC server; stored so
     *                Terminal sessions can read it and respond to the challenge.
     */
    public async acquire(ipcPort: number, nonce: string): Promise<void> {
        this.currentLock = {
            pid: process.pid,
            ipcPort,
            lastHeartbeat: new Date().toISOString(),
            status: 'active',
            nonce,
        };
        fs.writeFileSync(this.lockPath, JSON.stringify(this.currentLock, null, 2), { encoding: 'utf8', mode: 0o600 });
    }

    /**
     * Updates the heartbeat of the current lock.
     */
    public async heartbeat(): Promise<void> {
        if (!this.currentLock) return;
        this.currentLock.lastHeartbeat = new Date().toISOString();
        fs.writeFileSync(this.lockPath, JSON.stringify(this.currentLock, null, 2), { encoding: 'utf8', mode: 0o600 });
    }

    /**
     * Releases the lock.
     */
    public async release(): Promise<void> {
        if (this.currentLock && this.currentLock.pid === process.pid) {
            if (fs.existsSync(this.lockPath)) {
                fs.unlinkSync(this.lockPath);
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
            fs.writeFileSync(this.lockPath, JSON.stringify(this.currentLock, null, 2), { encoding: 'utf8', mode: 0o600 });
        }
    }
}

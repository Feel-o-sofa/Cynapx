/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getLocksDir, getProjectHash } from './paths';

export interface LockInfo {
    pid: number;
    ipcPort: number;
    lastHeartbeat: string;
    status: 'active' | 'shutting-down';
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
                // If it's a stale lock, perform a clean-up
                console.error(`[*] Stale lock detected (PID ${lock.pid} is dead). Cleaning up residual files...`);
                
                // 1. Remove the lock file itself
                if (fs.existsSync(this.lockPath)) fs.unlinkSync(this.lockPath);

                // 2. Clear residual DB journal files that might keep the DB locked
                const dbPath = this.lockPath.replace('.lock', '.db').replace('locks' + path.sep, '');
                // The lock is in ~/.cynapx/locks/<hash>.lock, DB is in ~/.cynapx/<hash>.db
                const dbBase = this.lockPath.replace(path.join('locks', path.basename(this.lockPath)), path.basename(this.lockPath, '.lock'));
                const dir = path.dirname(path.dirname(this.lockPath));
                const dbFile = path.join(dir, `${path.basename(this.lockPath, '.lock')}.db`);
                
                ['', '-wal', '-shm'].forEach(suffix => {
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
     */
    public async acquire(ipcPort: number): Promise<void> {
        this.currentLock = {
            pid: process.pid,
            ipcPort,
            lastHeartbeat: new Date().toISOString(),
            status: 'active'
        };
        fs.writeFileSync(this.lockPath, JSON.stringify(this.currentLock, null, 2), 'utf8');
    }

    /**
     * Updates the heartbeat of the current lock.
     */
    public async heartbeat(): Promise<void> {
        if (!this.currentLock) return;
        this.currentLock.lastHeartbeat = new Date().toISOString();
        fs.writeFileSync(this.lockPath, JSON.stringify(this.currentLock, null, 2), 'utf8');
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
            fs.writeFileSync(this.lockPath, JSON.stringify(this.currentLock, null, 2), 'utf8');
        }
    }
}

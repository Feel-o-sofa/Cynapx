/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getCentralStorageDir } from './paths';

export type AuditEventType =
    | 'index_start'
    | 'index_complete'
    | 'index_error'
    | 'version_mismatch'
    | 'reindex_triggered'
    | 'purge'
    | 'unregister'
    | 'backup'
    | 'restore';

export interface AuditEvent {
    timestamp: string;
    event: AuditEventType;
    project?: string;
    projectPath?: string;
    /** Additional context fields (free-form) */
    [key: string]: unknown;
}

/**
 * AuditLogger appends structured NDJSON events to ~/.cynapx/audit.log.
 * Each line is a JSON object terminated by a newline.
 * Write failures are silently ignored to never disrupt the main pipeline.
 */
// O-6: rotate the audit log once it exceeds this size, keeping one backup.
const MAX_LOG_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export class AuditLogger {
    private readonly logPath: string;

    constructor(logPath?: string) {
        this.logPath = logPath ?? path.join(getCentralStorageDir(), 'audit.log');
    }

    /**
     * Renames the current log to `<path>.1` (overwriting any previous
     * backup) when it exceeds MAX_LOG_SIZE_BYTES, so the audit log doesn't
     * grow without bound.
     */
    private rotateIfNeeded(): void {
        try {
            const stat = fs.statSync(this.logPath);
            if (stat.size < MAX_LOG_SIZE_BYTES) return;
            fs.renameSync(this.logPath, `${this.logPath}.1`);
        } catch {
            // Missing file or rotation failure — fall through and let
            // appendFileSync create/append as usual.
        }
    }

    public log(eventType: AuditEventType, fields: Omit<AuditEvent, 'timestamp' | 'event'> = {}): void {
        const entry: AuditEvent = {
            timestamp: new Date().toISOString(),
            event: eventType,
            ...fields
        };
        try {
            this.rotateIfNeeded();
            fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
        } catch {
            // Audit logging must never crash the server
        }
    }

    /** Returns the path of the audit log file. */
    public get path(): string {
        return this.logPath;
    }

    /**
     * Reads and parses up to `limit` most-recent audit entries (default 100).
     * Returns an empty array on any error.
     */
    public readRecent(limit = 100): AuditEvent[] {
        try {
            if (!fs.existsSync(this.logPath)) return [];
            const lines = this.tailLines(limit);
            return lines
                .map(l => {
                    try { return JSON.parse(l) as AuditEvent; } catch { return null; }
                })
                .filter((e): e is AuditEvent => e !== null);
        } catch {
            return [];
        }
    }

    /**
     * O-9: tail-based partial read. Previously readRecent() loaded the entire
     * file (up to MAX_LOG_SIZE_BYTES = 100MB) just to take the last `limit`
     * lines. Instead, read fixed-size chunks backwards from EOF until we have
     * enough complete lines, so cost scales with `limit`, not file size.
     */
    private tailLines(limit: number): string[] {
        const CHUNK = 64 * 1024;
        const fd = fs.openSync(this.logPath, 'r');
        try {
            const size = fs.fstatSync(fd).size;
            if (size === 0) return [];
            let pos = size;
            const chunks: Buffer[] = [];
            let newlineCount = 0;
            // Read backwards a chunk at a time until we have > limit newlines
            // (one extra so a partial leading line is dropped) or hit BOF. Decode
            // the assembled Buffer once at the end so no multibyte UTF-8 sequence
            // is split across per-chunk toString() calls.
            while (pos > 0) {
                const readSize = Math.min(CHUNK, pos);
                pos -= readSize;
                const buf = Buffer.alloc(readSize);
                fs.readSync(fd, buf, 0, readSize, pos);
                chunks.unshift(buf);
                for (const b of buf) { if (b === 0x0a) newlineCount++; }
                if (newlineCount > limit) break;
            }
            const collected = Buffer.concat(chunks).toString('utf8');
            const lines = collected.split('\n').filter(l => l.trim() !== '');
            return lines.slice(-limit);
        } finally {
            fs.closeSync(fd);
        }
    }
}

/** Module-level singleton — lazy-initialised on first use. */
let _instance: AuditLogger | null = null;
export function getAuditLogger(): AuditLogger {
    if (!_instance) _instance = new AuditLogger();
    return _instance;
}

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
    | 'unregister';

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
export class AuditLogger {
    private readonly logPath: string;

    constructor(logPath?: string) {
        this.logPath = logPath ?? path.join(getCentralStorageDir(), 'audit.log');
    }

    public log(eventType: AuditEventType, fields: Omit<AuditEvent, 'timestamp' | 'event'> = {}): void {
        const entry: AuditEvent = {
            timestamp: new Date().toISOString(),
            event: eventType,
            ...fields
        };
        try {
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
            const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(l => l.trim() !== '');
            const recent = lines.slice(-limit);
            return recent.map(l => JSON.parse(l) as AuditEvent);
        } catch {
            return [];
        }
    }
}

/** Module-level singleton — lazy-initialised on first use. */
let _instance: AuditLogger | null = null;
export function getAuditLogger(): AuditLogger {
    if (!_instance) _instance = new AuditLogger();
    return _instance;
}

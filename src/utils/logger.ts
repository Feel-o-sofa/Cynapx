/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    SILENT = 4
}

/**
 * Lightweight structured logger.
 * Outputs JSON to stderr (compatible with MCP stdio transport).
 *
 * Usage:
 *   const log = new Logger('ModuleName');
 *   log.info('Server started', { port: 3000 });
 *   log.error('Failed to connect', { error: err.message });
 */
export class Logger {
    private static globalLevel: LogLevel = LogLevel.INFO;

    constructor(private context: string) {}

    static setGlobalLevel(level: LogLevel): void {
        Logger.globalLevel = level;
    }

    static getGlobalLevel(): LogLevel {
        return Logger.globalLevel;
    }

    debug(msg: string, data?: Record<string, unknown>): void {
        if (Logger.globalLevel <= LogLevel.DEBUG) this.emit('DEBUG', msg, data);
    }

    info(msg: string, data?: Record<string, unknown>): void {
        if (Logger.globalLevel <= LogLevel.INFO) this.emit('INFO', msg, data);
    }

    warn(msg: string, data?: Record<string, unknown>): void {
        if (Logger.globalLevel <= LogLevel.WARN) this.emit('WARN', msg, data);
    }

    error(msg: string, data?: Record<string, unknown>): void {
        if (Logger.globalLevel <= LogLevel.ERROR) this.emit('ERROR', msg, data);
    }

    private emit(level: string, msg: string, data?: Record<string, unknown>): void {
        const entry: Record<string, unknown> = {
            ts: new Date().toISOString(),
            level,
            ctx: this.context,
            msg
        };
        if (data) entry.data = Logger.normalizeData(data);
        // Always stderr — stdout is reserved for the MCP stdio protocol.
        console.error(JSON.stringify(entry));
    }

    /**
     * Error values JSON-serialize to `{}` (their own enumerable props are
     * empty), which loses the message. Replace any Error in the data object
     * with a plain `{ message, stack? }` so diagnostics survive serialization.
     */
    private static normalizeData(data: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) {
            if (v instanceof Error) {
                out[k] = { message: v.message, name: v.name };
            } else {
                out[k] = v;
            }
        }
        return out;
    }
}

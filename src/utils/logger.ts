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
        if (data) entry.data = data;
        console.error(JSON.stringify(entry));
    }
}

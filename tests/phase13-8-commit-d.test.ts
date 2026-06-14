/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 13-8 commit D regression tests — structured logging wiring.
 *
 * - Logger emits structured JSON to STDERR only (never stdout — stdout is
 *   reserved for the MCP stdio protocol).
 * - Logger respects the global level filter.
 * - The library modules that were wired to the Logger no longer write to
 *   stdout via console.log (stdio non-pollution guard).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogLevel } from '../src/utils/logger';

describe('Logger: structured output on stderr only', () => {
    afterEach(() => { vi.restoreAllMocks(); Logger.setGlobalLevel(LogLevel.INFO); });

    it('writes a JSON entry to stderr (console.error) and nothing to stdout', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const outSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

        const log = new Logger('TestCtx');
        log.info('hello world', { a: 1 });
        log.error('boom', { detail: 'oops' });

        // stderr received structured JSON.
        expect(errSpy).toHaveBeenCalledTimes(2);
        const first = JSON.parse(errSpy.mock.calls[0][0] as string);
        expect(first.level).toBe('INFO');
        expect(first.ctx).toBe('TestCtx');
        expect(first.msg).toBe('hello world');
        expect(first.data).toEqual({ a: 1 });
        const second = JSON.parse(errSpy.mock.calls[1][0] as string);
        expect(second.level).toBe('ERROR');

        // Nothing went to stdout.
        expect(outSpy).not.toHaveBeenCalled();
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('normalizes Error values in data so the message survives JSON', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const log = new Logger('Err');
        log.error('failed', { detail: new TypeError('kaboom') });
        const entry = JSON.parse(errSpy.mock.calls[0][0] as string);
        expect(entry.data.detail.message).toBe('kaboom');
        expect(entry.data.detail.name).toBe('TypeError');
    });

    it('respects the global level filter', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        Logger.setGlobalLevel(LogLevel.WARN);
        const log = new Logger('Lvl');
        log.debug('debug-msg');
        log.info('info-msg');
        log.warn('warn-msg');
        log.error('error-msg');
        // Only warn + error pass the WARN threshold.
        expect(errSpy).toHaveBeenCalledTimes(2);
        const levels = errSpy.mock.calls.map(c => JSON.parse(c[0] as string).level);
        expect(levels).toEqual(['WARN', 'ERROR']);
    });

    it('SILENT suppresses everything', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        Logger.setGlobalLevel(LogLevel.SILENT);
        const log = new Logger('Quiet');
        log.error('should not appear');
        expect(errSpy).not.toHaveBeenCalled();
    });
});

describe('stdio non-pollution: wired library modules avoid console.log (stdout)', () => {
    // These files were wired to the Logger in commit D. None of them should
    // write diagnostics to stdout, which would corrupt the MCP stdio stream.
    const wiredFiles = [
        'src/indexer/embedding-manager.ts',
        'src/server/ipc-coordinator.ts',
        'src/server/workspace-manager.ts',
        'src/server/health-monitor.ts',
        'src/server/mcp-server.ts',
        'src/indexer/dependency-parser.ts',
        'src/indexer/language-registry.ts',
        'src/indexer/worker-pool.ts',
        'src/indexer/index-worker.ts',
        'src/indexer/update-pipeline.ts',
        'src/indexer/git-service.ts',
        'src/indexer/consistency-checker.ts',
        'src/watcher/file-watcher.ts',
        'src/db/vector-repository.ts',
        'src/utils/lock-manager.ts',
        'src/utils/lifecycle-manager.ts',
        'src/server/api-server.ts',
    ];

    it('has no console.log / console.info / console.warn calls in wired modules', () => {
        const offenders: string[] = [];
        for (const rel of wiredFiles) {
            const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
            // Direct stdout/console.log usage (the logger funnels to stderr instead).
            if (/console\.(log|info|warn)\s*\(/.test(src)) offenders.push(rel);
            if (/process\.stdout\.write/.test(src)) offenders.push(rel);
        }
        expect(offenders).toEqual([]);
    });

    it('each wired module declares a module-level Logger', () => {
        const missing: string[] = [];
        for (const rel of wiredFiles) {
            const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
            if (!/new Logger\(/.test(src)) missing.push(rel);
        }
        expect(missing).toEqual([]);
    });
});

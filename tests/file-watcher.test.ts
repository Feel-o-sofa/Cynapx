/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for FileWatcher (src/watcher/file-watcher.ts).
 * Covers H-2 (extension allowlist via LanguageRegistry + metadata extensions)
 * and H-3 (flush concurrency guard / queue draining).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from '../src/watcher/file-watcher';
import type { UpdatePipeline } from '../src/indexer/update-pipeline';

function makePipeline(overrides: Partial<Record<keyof UpdatePipeline, unknown>> = {}): UpdatePipeline {
    return {
        processBatch: vi.fn().mockResolvedValue(undefined),
        syncWithGit: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as UpdatePipeline;
}

describe('FileWatcher: H-2 extension allowlist', () => {
    let watcher: FileWatcher;

    beforeEach(() => {
        watcher = new FileWatcher(makePipeline(), '/mock/project');
    });

    it('queues changes for tree-sitter language extensions (e.g. .rs, .go)', () => {
        (watcher as any).handleChange('ADD', '/mock/project/src/main.rs');
        (watcher as any).handleChange('ADD', '/mock/project/src/main.go');
        expect((watcher as any).queue).toHaveLength(2);
    });

    it('queues changes for metadata extensions (e.g. .yaml, .md, .json)', () => {
        (watcher as any).handleChange('MODIFY', '/mock/project/config.yaml');
        (watcher as any).handleChange('MODIFY', '/mock/project/README.md');
        (watcher as any).handleChange('MODIFY', '/mock/project/package.json');
        expect((watcher as any).queue).toHaveLength(3);
    });

    it('ignores extensions that are not watched (e.g. .png, .exe)', () => {
        (watcher as any).handleChange('ADD', '/mock/project/assets/logo.png');
        (watcher as any).handleChange('ADD', '/mock/project/bin/tool.exe');
        expect((watcher as any).queue).toHaveLength(0);
    });

    it('still queues changes for legacy hardcoded extensions (.ts, .js, .py)', () => {
        (watcher as any).handleChange('ADD', '/mock/project/src/a.ts');
        (watcher as any).handleChange('ADD', '/mock/project/src/b.js');
        (watcher as any).handleChange('ADD', '/mock/project/src/c.py');
        expect((watcher as any).queue).toHaveLength(3);
    });
});

describe('FileWatcher: H-3 flush concurrency guard', () => {
    let pipeline: UpdatePipeline;
    let watcher: FileWatcher;

    beforeEach(() => {
        pipeline = makePipeline();
        watcher = new FileWatcher(pipeline, '/mock/project');
    });

    it('does not lose events queued while a flush is in-flight', async () => {
        let resolveFirst: () => void = () => {};
        const firstFlushGate = new Promise<void>((resolve) => { resolveFirst = resolve; });

        (pipeline.processBatch as any).mockImplementationOnce(async () => {
            // While this first flush is "in progress", queue another event.
            (watcher as any).handleChange('MODIFY', '/mock/project/src/b.ts');
            await firstFlushGate;
        });

        (watcher as any).handleChange('ADD', '/mock/project/src/a.ts');

        const flushPromise = (watcher as any).flush();

        // Allow the mocked processBatch to start and queue the second event.
        await Promise.resolve();
        await Promise.resolve();

        // The second event should be queued, not processed yet.
        expect((watcher as any).queue.length).toBeGreaterThan(0);

        resolveFirst();
        await flushPromise;

        // After the in-flight flush finishes, the queued event should still
        // be present and a follow-up flush scheduled (not dropped).
        expect((watcher as any).queue).toHaveLength(1);
        expect((watcher as any).timer).not.toBeNull();

        // Manually trigger the scheduled follow-up flush.
        clearTimeout((watcher as any).timer);
        (watcher as any).timer = null;
        await (watcher as any).flush();

        expect(pipeline.processBatch).toHaveBeenCalledTimes(2);
        const secondCallEvents = (pipeline.processBatch as any).mock.calls[1][0];
        expect(secondCallEvents).toHaveLength(1);
        expect(secondCallEvents[0].file_path).toBe('/mock/project/src/b.ts');
        expect((watcher as any).queue).toHaveLength(0);
    });

    it('a second concurrent flush() call while one is running is a no-op', async () => {
        let resolveFirst: () => void = () => {};
        const firstFlushGate = new Promise<void>((resolve) => { resolveFirst = resolve; });
        (pipeline.processBatch as any).mockImplementationOnce(async () => { await firstFlushGate; });

        (watcher as any).handleChange('ADD', '/mock/project/src/a.ts');

        const flush1 = (watcher as any).flush();
        await Promise.resolve();

        // Second call should return immediately without consuming the queue.
        const flush2 = (watcher as any).flush();
        await flush2;

        resolveFirst();
        await flush1;

        expect(pipeline.processBatch).toHaveBeenCalledTimes(1);
    });

    it('clears the pending timer when threshold-triggered flush fires', () => {
        for (let i = 0; i < 50; i++) {
            (watcher as any).handleChange('ADD', `/mock/project/src/file${i}.ts`);
        }
        expect((watcher as any).timer).toBeNull();
    });
});

describe('FileWatcher: H1 stale timer handle during in-flight flush', () => {
    let pipeline: UpdatePipeline;
    let watcher: FileWatcher;

    beforeEach(() => {
        vi.useFakeTimers();
        pipeline = makePipeline();
        watcher = new FileWatcher(pipeline, '/mock/project');
    });

    afterEach(() => {
        watcher.dispose();
        vi.useRealTimers();
    });

    it('does not strand an event when its batch timer fires while a flush is in-flight', async () => {
        let resolveFirst: () => void = () => {};
        const firstFlushGate = new Promise<void>((resolve) => { resolveFirst = resolve; });
        (pipeline.processBatch as any).mockImplementationOnce(async () => { await firstFlushGate; });

        // Event A starts a (slow) flush.
        (watcher as any).handleChange('ADD', '/mock/project/src/a.ts');
        const flushPromise = (watcher as any).flush();
        expect((watcher as any).flushing).toBe(true);

        // Event B arrives mid-flush: queued + new batch timer T2 scheduled.
        (watcher as any).handleChange('MODIFY', '/mock/project/src/b.ts');
        expect((watcher as any).timer).not.toBeNull();

        // T2 fires while the flush is still running: its flush() call hits the
        // `flushing` guard and early-returns. Pre-fix, `this.timer` kept the
        // stale fired handle, so the post-flush re-scheduler never rescheduled.
        await vi.advanceTimersByTimeAsync(1000);
        expect((watcher as any).flushing).toBe(true); // first flush still in-flight
        expect((watcher as any).queue).toHaveLength(1); // B still queued

        // Finish the in-flight flush.
        resolveFirst();
        await flushPromise;

        // The post-flush re-scheduler must have scheduled a follow-up flush for B.
        expect((watcher as any).timer).not.toBeNull();

        await vi.advanceTimersByTimeAsync(1000);
        await vi.runAllTimersAsync();

        expect(pipeline.processBatch).toHaveBeenCalledTimes(2);
        const secondCallEvents = (pipeline.processBatch as any).mock.calls[1][0];
        expect(secondCallEvents).toHaveLength(1);
        expect(secondCallEvents[0].file_path).toBe('/mock/project/src/b.ts');
        expect((watcher as any).queue).toHaveLength(0);
    });
});

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for UpdatePipeline.processBatch() lastIndexedCommit watermark
 * handling (H-7): a partial batch failure must not advance the watermark
 * past the failed file, so the next sync retries it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdatePipeline } from '../src/indexer/update-pipeline';
import type { CodeParser, FileChangeEvent } from '../src/indexer/types';

function makeMockDb(callLog?: string[]) {
    const stmt = { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
    return {
        prepare: vi.fn().mockImplementation((sql: string) => {
            if (callLog && /^\s*BEGIN/i.test(sql)) {
                return { ...stmt, run: vi.fn().mockImplementation(() => { callLog.push('BEGIN'); }) };
            }
            return stmt;
        }),
        inTransaction: false,
        transaction: vi.fn().mockImplementation((fn: () => void) => fn),
    } as any;
}

function makeMockNodeRepo() {
    let nextId = 1;
    return {
        getNodeIdsByFilePath: vi.fn().mockReturnValue([]),
        deleteNodesByFilePath: vi.fn(),
        createNode: vi.fn().mockImplementation(() => nextId++),
    } as any;
}

function makeMockEdgeRepo() {
    return {
        deleteEdgesByNodeId: vi.fn(),
        createEdge: vi.fn(),
    } as any;
}

function makeMockMetadataRepo() {
    return {
        setLastIndexedCommit: vi.fn(),
        getLastIndexedCommit: vi.fn().mockReturnValue('old-commit'),
    } as any;
}

describe('UpdatePipeline.processBatch() — H-7 lastIndexedCommit watermark', () => {
    let db: ReturnType<typeof makeMockDb>;
    let nodeRepo: ReturnType<typeof makeMockNodeRepo>;
    let edgeRepo: ReturnType<typeof makeMockEdgeRepo>;
    let metadataRepo: ReturnType<typeof makeMockMetadataRepo>;
    let parser: CodeParser;
    let pipeline: UpdatePipeline;

    beforeEach(() => {
        db = makeMockDb();
        nodeRepo = makeMockNodeRepo();
        edgeRepo = makeMockEdgeRepo();
        metadataRepo = makeMockMetadataRepo();
        parser = { parse: vi.fn() } as any;

        pipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, parser, metadataRepo, undefined, undefined, '/mock/project');
        // Avoid spawning the real Python embedding sidecar from the background refresh.
        (pipeline as any).embeddingManager = { refreshAll: vi.fn().mockResolvedValue(undefined), isAvailable: false };
    });

    it('advances lastIndexedCommit to targetCommit when all files succeed', async () => {
        (parser.parse as any).mockResolvedValue({ nodes: [], edges: [] });

        const events: FileChangeEvent[] = [
            { event: 'ADD', file_path: '/mock/project/src/a.ts', commit: 'c1' },
            { event: 'ADD', file_path: '/mock/project/src/b.ts', commit: 'c2' },
        ];

        await pipeline.processBatch(events, Date.now(), 'new-head');

        expect(metadataRepo.setLastIndexedCommit).toHaveBeenCalledWith('new-head');
    });

    it('does NOT advance lastIndexedCommit when one file fails to parse', async () => {
        (parser.parse as any).mockImplementation(async (filePath: string) => {
            if (filePath.endsWith('b.ts')) throw new Error('parse failure');
            return { nodes: [], edges: [] };
        });

        const events: FileChangeEvent[] = [
            { event: 'ADD', file_path: '/mock/project/src/a.ts', commit: 'c1' },
            { event: 'ADD', file_path: '/mock/project/src/b.ts', commit: 'c2' },
        ];

        await pipeline.processBatch(events, Date.now(), 'new-head');

        expect(metadataRepo.setLastIndexedCommit).not.toHaveBeenCalled();
    });

    it('does not call setLastIndexedCommit when targetCommit is not provided', async () => {
        (parser.parse as any).mockResolvedValue({ nodes: [], edges: [] });

        const events: FileChangeEvent[] = [
            { event: 'ADD', file_path: '/mock/project/src/a.ts', commit: 'c1' },
        ];

        await pipeline.processBatch(events, Date.now());

        expect(metadataRepo.setLastIndexedCommit).not.toHaveBeenCalled();
    });
});

describe('UpdatePipeline.processBatch() — H-4 git prefetch before transaction', () => {
    let db: ReturnType<typeof makeMockDb>;
    let nodeRepo: ReturnType<typeof makeMockNodeRepo>;
    let edgeRepo: ReturnType<typeof makeMockEdgeRepo>;
    let metadataRepo: ReturnType<typeof makeMockMetadataRepo>;
    let parser: CodeParser;
    let gitService: any;
    let callLog: string[];
    let pipeline: UpdatePipeline;

    beforeEach(() => {
        callLog = [];
        db = makeMockDb(callLog);
        nodeRepo = makeMockNodeRepo();
        edgeRepo = makeMockEdgeRepo();
        metadataRepo = makeMockMetadataRepo();
        parser = { parse: vi.fn().mockResolvedValue({ nodes: [], edges: [] }) } as any;

        gitService = {
            getHistoryForFile: vi.fn().mockImplementation(async (fp: string) => {
                callLog.push(`getHistoryForFile:${fp}`);
                return [{ hash: 'h1', message: 'm', author: 'a', date: 'd' }];
            }),
        };

        pipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, parser, metadataRepo, gitService, undefined, '/mock/project');
        (pipeline as any).embeddingManager = { refreshAll: vi.fn().mockResolvedValue(undefined), isAvailable: false };
    });

    it('fetches all git history BEFORE BEGIN — none inside the transaction', async () => {
        const events: FileChangeEvent[] = [
            { event: 'ADD', file_path: '/mock/project/src/a.ts', commit: 'c1' },
            { event: 'MODIFY', file_path: '/mock/project/src/b.ts', commit: 'c2' },
        ];

        await pipeline.processBatch(events, Date.now(), 'new-head');

        // BEGIN must appear in the call log, and every getHistoryForFile call
        // must come strictly before it (no git subprocess under an open txn).
        const beginIndex = callLog.indexOf('BEGIN');
        expect(beginIndex).toBeGreaterThanOrEqual(0);
        const historyIndices = callLog
            .map((entry, i) => (entry.startsWith('getHistoryForFile:') ? i : -1))
            .filter(i => i >= 0);
        expect(historyIndices.length).toBe(2);
        for (const hi of historyIndices) {
            expect(hi).toBeLessThan(beginIndex);
        }
    });

    it('prefetched history maps to the same nodes the per-file fetch would have', async () => {
        const history = [{ hash: 'hX', message: 'msg', author: 'auth', date: 'date' }];
        gitService.getHistoryForFile.mockResolvedValue(history);
        (parser.parse as any).mockResolvedValue({
            nodes: [{ qualified_name: 'a#foo', symbol_type: 'function', language: 'ts', file_path: '/mock/project/src/a.ts', start_line: 1, end_line: 2, visibility: 'public', is_generated: false, last_updated_commit: 'c1', version: 1 }],
            edges: [],
        });

        const events: FileChangeEvent[] = [
            { event: 'ADD', file_path: '/mock/project/src/a.ts', commit: 'c1' },
        ];

        await pipeline.processBatch(events, Date.now(), 'new-head');

        // createNode received the node with the prefetched history attached.
        expect(nodeRepo.createNode).toHaveBeenCalledTimes(1);
        const createdNode = (nodeRepo.createNode as any).mock.calls[0][0];
        expect(createdNode.history).toEqual(history);
    });

    it('de-duplicates history fetches across the batch', async () => {
        const events: FileChangeEvent[] = [
            { event: 'ADD', file_path: '/mock/project/src/a.ts', commit: 'c1' },
            { event: 'MODIFY', file_path: '/mock/project/src/a.ts', commit: 'c2' },
        ];

        await pipeline.processBatch(events, Date.now(), 'new-head');

        // Same path appears twice but git history is fetched once.
        expect(gitService.getHistoryForFile).toHaveBeenCalledTimes(1);
    });
});

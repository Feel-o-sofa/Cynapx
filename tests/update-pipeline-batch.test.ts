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

function makeMockDb() {
    const stmt = { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([]) };
    return {
        prepare: vi.fn().mockReturnValue(stmt),
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

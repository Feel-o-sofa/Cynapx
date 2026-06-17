/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Tests for the find_similar_symbols tool (P9-3) and the supporting
 * VectorRepository.getEmbedding() method.
 */
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { executeTool, ToolDeps } from '../src/server/tool-dispatcher';
import { VectorRepository } from '../src/db/vector-repository';

// ---------------------------------------------------------------------------
// Mock ToolDeps helper
// ---------------------------------------------------------------------------

interface MockOpts {
    node?: any;
    embedding?: number[] | null;
    searchResults?: { id: number; distance: number }[];
    nodesById?: Record<number, any>;
    noContext?: boolean;
    noVectorRepo?: boolean;
}

function makeDeps(opts: MockOpts = {}): ToolDeps {
    const nodesById = opts.nodesById ?? {};

    const mockGraphEngine = {
        getNodeByQualifiedName: vi.fn().mockReturnValue(opts.node ?? null),
        getNodeById: vi.fn((id: number) => nodesById[id] ?? null),
        nodeRepo: {
            getNodeByQualifiedName: vi.fn().mockReturnValue(opts.node ?? null),
            searchSymbols: vi.fn().mockReturnValue([]),
        },
    };

    const mockVectorRepo = opts.noVectorRepo ? null : {
        getEmbedding: vi.fn().mockReturnValue(opts.embedding === undefined ? [0.1, 0.2, 0.3] : opts.embedding),
        search: vi.fn().mockReturnValue(opts.searchResults ?? []),
    };

    const mockCtx = opts.noContext ? null : {
        graphEngine: mockGraphEngine,
        vectorRepo: mockVectorRepo,
        projectPath: '/mock/project',
    };

    const base: ToolDeps = {
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
        getContext: vi.fn().mockReturnValue(mockCtx),
        isTerminal: vi.fn().mockReturnValue(false),
        getTerminalCoordinator: vi.fn().mockReturnValue(undefined),
        embeddingProvider: {
            generate: vi.fn().mockResolvedValue([]),
            generateBatch: vi.fn().mockResolvedValue([]),
            getDimensions: vi.fn().mockReturnValue(0),
            getModelName: vi.fn().mockReturnValue('mock'),
        } as any,
        workspaceManager: { getAllContexts: vi.fn().mockReturnValue([]) } as any,
        remediationEngine: {} as any,
        onInitialize: undefined,
        onPurge: undefined,
        markReady: vi.fn(),
        getIsInitialized: vi.fn().mockReturnValue(false),
        setIsInitialized: vi.fn(),
    };
    return base;
}

// ---------------------------------------------------------------------------
// find_similar_symbols — validation & lookup
// ---------------------------------------------------------------------------

describe('executeTool: find_similar_symbols', () => {
    it('returns isError when qualified_name is missing', async () => {
        const deps = makeDeps();
        const result = await executeTool('find_similar_symbols', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/qualified_name/i);
    });

    it('returns isError when no active project', async () => {
        const deps = makeDeps({ noContext: true });
        const result = await executeTool('find_similar_symbols', { qualified_name: 'a#b' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/No active project/i);
    });

    it('returns isError when the symbol is not found', async () => {
        const deps = makeDeps({ node: null });
        const result = await executeTool('find_similar_symbols', { qualified_name: 'missing#Symbol' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not found/i);
    });

    it('returns an informative (non-error) message when no embedding exists', async () => {
        const deps = makeDeps({
            node: { id: 1, qualified_name: 'a#b', symbol_type: 'function', file_path: '/a.ts' },
            embedding: null,
        });
        const result = await executeTool('find_similar_symbols', { qualified_name: 'a#b' }, deps);
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toMatch(/no embedding/i);
    });

    it('performs K-NN search, excludes the query node, and includes distance-based scores', async () => {
        const queryNode = { id: 10, qualified_name: 'a#query', symbol_type: 'function', file_path: '/a.ts' };
        const nodesById = {
            10: queryNode,
            20: { id: 20, qualified_name: 'a#neighbor1', symbol_type: 'function', file_path: '/b.ts', signature: 'foo()', fan_in: 3, tags: ['util'] },
            30: { id: 30, qualified_name: 'a#neighbor2', symbol_type: 'class', file_path: '/c.ts' },
        };
        const deps = makeDeps({
            node: queryNode,
            embedding: [0.1, 0.2, 0.3],
            // query node (id 10) appears first and must be filtered out
            searchResults: [
                { id: 10, distance: 0 },
                { id: 20, distance: 0.5 },
                { id: 30, distance: 1 },
            ],
            nodesById,
        });

        const result = await executeTool('find_similar_symbols', { qualified_name: 'a#query', limit: 5 }, deps);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(Array.isArray(parsed)).toBe(true);
        // query node excluded
        expect(parsed.map((r: any) => r.qname)).toEqual(['a#neighbor1', 'a#neighbor2']);
        // structured output fields
        expect(parsed[0]).toMatchObject({ qname: 'a#neighbor1', type: 'function', file: '/b.ts', signature: 'foo()', fan_in: 3, tags: ['util'] });
        // score = 1 / (1 + distance)
        expect(parsed[0].score).toBeCloseTo(1 / 1.5, 6);
        expect(parsed[1].score).toBeCloseTo(1 / 2, 6);
    });

    it('requests limit + 1 neighbors to account for the query node', async () => {
        const queryNode = { id: 1, qualified_name: 'a#q', symbol_type: 'function', file_path: '/a.ts' };
        const deps = makeDeps({ node: queryNode, embedding: [0.1], searchResults: [], nodesById: { 1: queryNode } });
        await executeTool('find_similar_symbols', { qualified_name: 'a#q', limit: 7 }, deps);
        const vectorRepo = (deps.getContext() as any).vectorRepo;
        expect(vectorRepo.search).toHaveBeenCalledWith([0.1], 8);
    });

    describe('limit clamping', () => {
        async function searchLimitFor(limit: any): Promise<number> {
            const queryNode = { id: 1, qualified_name: 'a#q', symbol_type: 'function', file_path: '/a.ts' };
            const deps = makeDeps({ node: queryNode, embedding: [0.1], searchResults: [], nodesById: { 1: queryNode } });
            await executeTool('find_similar_symbols', { qualified_name: 'a#q', limit }, deps);
            const vectorRepo = (deps.getContext() as any).vectorRepo;
            // search is called with (embedding, effectiveLimit + 1)
            return vectorRepo.search.mock.calls[0][1] - 1;
        }

        it('clamps negative limit up to 1', async () => {
            expect(await searchLimitFor(-5)).toBe(1);
        });
        it('clamps zero limit up to 1', async () => {
            expect(await searchLimitFor(0)).toBe(1);
        });
        it('clamps over-100 limit down to 100', async () => {
            expect(await searchLimitFor(500)).toBe(100);
        });
        it('defaults to 10 when limit is not provided', async () => {
            expect(await searchLimitFor(undefined)).toBe(10);
        });
    });
});

// ---------------------------------------------------------------------------
// VectorRepository.getEmbedding — unit tests
// ---------------------------------------------------------------------------

describe('VectorRepository.getEmbedding', () => {
    function makeDbWithEmbeddingTable(): Database.Database {
        const db = new Database(':memory:');
        // Plain table standing in for the vec0 virtual table; getEmbedding only
        // reads the `embedding` BLOB column by rowid, so this is sufficient.
        db.exec('CREATE TABLE node_embeddings (rowid INTEGER PRIMARY KEY, embedding BLOB)');
        return db;
    }

    it('returns the stored vector when an embedding exists', () => {
        const db = makeDbWithEmbeddingTable();
        const vec = [0.5, -1.25, 3.0];
        const buf = Buffer.from(new Float32Array(vec).buffer);
        db.prepare('INSERT INTO node_embeddings (rowid, embedding) VALUES (?, ?)').run(42, buf);

        const repo = new VectorRepository(db);
        const result = repo.getEmbedding(42);
        expect(result).not.toBeNull();
        expect(result!.length).toBe(3);
        expect(result![0]).toBeCloseTo(0.5, 5);
        expect(result![1]).toBeCloseTo(-1.25, 5);
        expect(result![2]).toBeCloseTo(3.0, 5);
        db.close();
    });

    it('returns null when no embedding exists for the id', () => {
        const db = makeDbWithEmbeddingTable();
        const repo = new VectorRepository(db);
        expect(repo.getEmbedding(999)).toBeNull();
        db.close();
    });

    it('returns null when the node_embeddings table does not exist', () => {
        const db = new Database(':memory:');
        const repo = new VectorRepository(db);
        expect(repo.getEmbedding(1)).toBeNull();
        db.close();
    });
});

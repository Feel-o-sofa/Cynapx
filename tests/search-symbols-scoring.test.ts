/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * P9-4: Unit tests for confidence scoring and distance normalization in
 * search results (mergeResultsRRF + search_symbols handler output).
 */
import { describe, it, expect, vi } from 'vitest';
import { mergeResultsRRF } from '../src/server/tools/_utils';
import { searchSymbolsHandler } from '../src/server/tools/search-symbols';
import { ToolDeps } from '../src/server/tool-dispatcher';

function node(id: number, qname: string) {
    return { id, qualified_name: qname, symbol_type: 'function', file_path: `f${id}.ts`, tags: [] };
}

describe('mergeResultsRRF (P9-4 confidence scoring)', () => {
    it('returns {node, score} pairs rather than bare nodes', () => {
        const merged = mergeResultsRRF([node(1, 'a')], [node(2, 'b')], 10);
        expect(merged).toHaveLength(2);
        for (const entry of merged) {
            expect(entry).toHaveProperty('node');
            expect(entry).toHaveProperty('score');
            expect(entry.node).toHaveProperty('qualified_name');
        }
    });

    it('produces positive scores sorted in descending order', () => {
        const merged = mergeResultsRRF(
            [node(1, 'a'), node(2, 'b'), node(3, 'c')],
            [node(4, 'd'), node(5, 'e')],
            10,
        );
        for (const entry of merged) {
            expect(entry.score).toBeGreaterThan(0);
        }
        for (let i = 1; i < merged.length; i++) {
            expect(merged[i - 1].score).toBeGreaterThanOrEqual(merged[i].score);
        }
    });

    it('gives nodes present in both keyword and vector results a higher (additive) score', () => {
        // Node 1 appears in both lists; nodes 2 and 3 appear in only one each.
        const merged = mergeResultsRRF(
            [node(1, 'shared'), node(2, 'kw-only')],
            [node(1, 'shared'), node(3, 'vec-only')],
            10,
        );
        const shared = merged.find(e => e.node.id === 1)!;
        const kwOnly = merged.find(e => e.node.id === 2)!;
        const vecOnly = merged.find(e => e.node.id === 3)!;
        expect(shared.score).toBeGreaterThan(kwOnly.score);
        expect(shared.score).toBeGreaterThan(vecOnly.score);
        // The shared node should rank first.
        expect(merged[0].node.id).toBe(1);
    });

    it('respects the limit', () => {
        const kw = [node(1, 'a'), node(2, 'b'), node(3, 'c')];
        const vec = [node(4, 'd'), node(5, 'e')];
        expect(mergeResultsRRF(kw, vec, 2)).toHaveLength(2);
    });
});

function makeDeps(opts: {
    keywordNodes: any[];
    vectorIds?: number[];
    nodesById?: Map<number, any>;
    vectorRepo?: any;
}): ToolDeps {
    const nodesById = opts.nodesById ?? new Map<number, any>();
    const ctx = {
        graphEngine: {
            nodeRepo: { searchSymbols: vi.fn().mockReturnValue(opts.keywordNodes) },
            getNodeById: vi.fn((id: number) => nodesById.get(id) ?? null),
        },
        vectorRepo: opts.vectorRepo ?? {
            search: vi.fn().mockReturnValue((opts.vectorIds ?? []).map(id => ({ id }))),
        },
    };
    return {
        embeddingProvider: {
            generate: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
            generateBatch: vi.fn().mockResolvedValue([]),
            getDimensions: vi.fn().mockReturnValue(3),
            getModelName: vi.fn().mockReturnValue('mock'),
        },
        workspaceManager: {
            getAllContexts: vi.fn().mockReturnValue([ctx]),
        } as any,
    } as unknown as ToolDeps;
}

describe('search_symbols output scoring (P9-4)', () => {
    it('includes a score field for keyword-only (non-semantic) results', async () => {
        const deps = makeDeps({ keywordNodes: [node(1, 'foo'), node(2, 'bar')] });
        const res = await searchSymbolsHandler.execute({ query: 'foo' }, deps);
        const parsed = JSON.parse(res.content[0].text);
        expect(parsed).toHaveLength(2);
        for (const r of parsed) {
            expect(r).toHaveProperty('score');
            expect(typeof r.score).toBe('number');
            expect(r.score).toBeGreaterThan(0);
        }
        // Positional scores: first result strictly higher than the second.
        expect(parsed[0].score).toBeGreaterThan(parsed[1].score);
        expect(parsed[0].score).toBe(1);
        expect(parsed[1].score).toBe(1 / 2);
    });

    it('includes RRF scores for semantic search results', async () => {
        const kw = [node(1, 'foo')];
        const nodesById = new Map([[2, node(2, 'foobar')], [1, node(1, 'foo')]]);
        const deps = makeDeps({ keywordNodes: kw, vectorIds: [1, 2], nodesById });
        const res = await searchSymbolsHandler.execute({ query: 'foo', semantic: true }, deps);
        const parsed = JSON.parse(res.content[0].text);
        expect(parsed.length).toBeGreaterThan(0);
        for (const r of parsed) {
            expect(r).toHaveProperty('score');
            expect(r.score).toBeGreaterThan(0);
        }
        // Node 1 is in both keyword and vector results -> ranks first.
        expect(parsed[0].qname).toBe('foo');
    });

    it('uses query_embedding when provided instead of generating one (P9-2 path)', async () => {
        const nodesById = new Map([[1, node(1, 'foo')]]);
        const deps = makeDeps({ keywordNodes: [node(1, 'foo')], vectorIds: [1], nodesById });
        const res = await searchSymbolsHandler.execute(
            { query: 'foo', query_embedding: [0.5, 0.5, 0.5] },
            deps,
        );
        const parsed = JSON.parse(res.content[0].text);
        expect(parsed.length).toBeGreaterThan(0);
        expect(parsed[0]).toHaveProperty('score');
        expect(deps.embeddingProvider.generate).not.toHaveBeenCalled();
    });

    it('falls back to keyword scoring when the semantic path throws', async () => {
        const deps = makeDeps({
            keywordNodes: [node(1, 'foo')],
            vectorRepo: { search: vi.fn(() => { throw new Error('vector failure'); }) },
        });
        const res = await searchSymbolsHandler.execute({ query: 'foo', semantic: true }, deps);
        const parsed = JSON.parse(res.content[0].text);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].score).toBe(1);
    });
});

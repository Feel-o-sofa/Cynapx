/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * P26-1: Unit tests for mergeResultsRRF() in src/server/tools/_utils.ts.
 * mergeResultsRRF performs Reciprocal Rank Fusion (RRF, k=60) over the
 * keyword and vector result lists used by the semantic search_symbols tool.
 * It is a dependency-free pure function (array in -> array out, no DB/async/
 * side-effects) so these are deterministic, prod-code-free gates.
 */
import { describe, it, expect } from 'vitest';
import { mergeResultsRRF } from '../src/server/tools/_utils.js';

describe('mergeResultsRRF', () => {
    it('orders nodes by RRF rank: earlier (lower rank) scores higher (single list)', () => {
        // vector list empty; keyword list ranks 0,1,2 -> scores 1/61 > 1/62 > 1/63.
        const keyword = [
            { id: 1, qualified_name: 'a' },
            { id: 2, qualified_name: 'b' },
            { id: 3, qualified_name: 'c' },
        ];
        const result = mergeResultsRRF(keyword, [], 10);
        expect(result.map(n => n.id)).toEqual([1, 2, 3]);
    });

    it('dedup boost: a node present in BOTH lists outranks a rank-0 unique node', () => {
        // Shared id (10) at rank 1 in both lists -> 2 * 1/(60+1+1) = 2/62 ≈ 0.03226.
        // Unique id (20) at rank 0 in keyword only -> 1/(60+0+1) = 1/61 ≈ 0.01639.
        // The shared node (accumulated across both lists) must win.
        const keyword = [
            { id: 20, qualified_name: 'unique' },
            { id: 10, qualified_name: 'shared' },
        ];
        const vector = [
            { id: 30, qualified_name: 'v0' },
            { id: 10, qualified_name: 'shared' },
        ];
        const result = mergeResultsRRF(keyword, vector, 10);
        expect(result[0].id).toBe(10);
        // and the shared node is ranked above the rank-0 unique keyword node.
        const idsInOrder = result.map(n => n.id);
        expect(idsInOrder.indexOf(10)).toBeLessThan(idsInOrder.indexOf(20));
    });

    it('sorts descending by score regardless of input order', () => {
        // Put the lowest-ranked (rank 2) item id first in the array; result must
        // still be sorted by accumulated RRF score, not insertion order.
        const keyword = [
            { id: 100, qualified_name: 'rank0' },
            { id: 200, qualified_name: 'rank1' },
            { id: 300, qualified_name: 'rank2' },
        ];
        const result = mergeResultsRRF(keyword, [], 10);
        // rank0 (1/61) > rank1 (1/62) > rank2 (1/63)
        expect(result.map(n => n.id)).toEqual([100, 200, 300]);
    });

    it('slices to limit when combined unique node count exceeds limit', () => {
        const keyword = [
            { id: 1, qualified_name: 'a' },
            { id: 2, qualified_name: 'b' },
            { id: 3, qualified_name: 'c' },
        ];
        const vector = [
            { id: 4, qualified_name: 'd' },
            { id: 5, qualified_name: 'e' },
        ];
        // 5 unique nodes, limit 2 -> length 2.
        const result = mergeResultsRRF(keyword, vector, 2);
        expect(result).toHaveLength(2);
        // Top two are the rank-0 nodes of each list (both 1/61): ids 1 and 4.
        expect(result.map(n => n.id).sort((a, b) => a - b)).toEqual([1, 4]);
    });

    it('returns [] for empty inputs', () => {
        expect(mergeResultsRRF([], [], 10)).toEqual([]);
    });

    it('restores original node object references via the internal nodeMap', () => {
        const nodeA = { id: 1, qualified_name: 'a', extra: 'payload' };
        const nodeB = { id: 2, qualified_name: 'b', extra: 'payload2' };
        const result = mergeResultsRRF([nodeA], [nodeB], 10);
        // Same object references are returned, not copies.
        expect(result).toContain(nodeA);
        expect(result).toContain(nodeB);
        expect(result.find(n => n.id === 1)).toBe(nodeA);
    });
});

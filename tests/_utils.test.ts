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
 *
 * P27-1: Unit tests for escapeXml()/escapeDot() in src/server/tools/_utils.ts.
 * These pure string-in/string-out functions back the export_graph tool's
 * graphml/dot formatters (escaping node/edge identifiers). escapeXml applies
 * `&`->`&amp;` FIRST so subsequently-emitted `&lt;`/`&gt;`/`&quot;` entities are
 * not double-escaped; escapeDot escapes `\`->`\\` then `"`->`\"`. Both use the
 * global `/g` flag. Like mergeResultsRRF these are dependency-free, so the
 * gates below are deterministic and require zero prod-code changes.
 */
import { describe, it, expect } from 'vitest';
import { mergeResultsRRF, escapeXml, escapeDot } from '../src/server/tools/_utils.js';

describe('mergeResultsRRF', () => {
    // P9-4: mergeResultsRRF now returns `{ node, score }` pairs (sorted by
    // descending RRF score) rather than bare node objects, so callers can
    // surface a confidence score. Assertions read through `.node` / `.score`.
    it('orders nodes by RRF rank: earlier (lower rank) scores higher (single list)', () => {
        // vector list empty; keyword list ranks 0,1,2 -> scores 1/61 > 1/62 > 1/63.
        const keyword = [
            { id: 1, qualified_name: 'a' },
            { id: 2, qualified_name: 'b' },
            { id: 3, qualified_name: 'c' },
        ];
        const result = mergeResultsRRF(keyword, [], 10);
        expect(result.map(e => e.node.id)).toEqual([1, 2, 3]);
    });

    it('attaches a positive numeric RRF score to every pair, sorted descending', () => {
        const keyword = [
            { id: 1, qualified_name: 'a' },
            { id: 2, qualified_name: 'b' },
            { id: 3, qualified_name: 'c' },
        ];
        const result = mergeResultsRRF(keyword, [], 10);
        for (const e of result) {
            expect(typeof e.score).toBe('number');
            expect(e.score).toBeGreaterThan(0);
        }
        for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].score).toBeGreaterThan(result[i].score);
        }
        // rank-0 keyword hit: 1/(60+0+1) = 1/61.
        expect(result[0].score).toBeCloseTo(1 / 61);
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
        expect(result[0].node.id).toBe(10);
        // The shared (accumulated) node scores higher than the unique keyword node.
        const shared = result.find(e => e.node.id === 10)!;
        const unique = result.find(e => e.node.id === 20)!;
        expect(shared.score).toBeGreaterThan(unique.score);
        // and the shared node is ranked above the rank-0 unique keyword node.
        const idsInOrder = result.map(e => e.node.id);
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
        expect(result.map(e => e.node.id)).toEqual([100, 200, 300]);
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
        expect(result.map(e => e.node.id).sort((a, b) => a - b)).toEqual([1, 4]);
    });

    it('returns [] for empty inputs', () => {
        expect(mergeResultsRRF([], [], 10)).toEqual([]);
    });

    it('restores original node object references via the internal nodeMap', () => {
        const nodeA = { id: 1, qualified_name: 'a', extra: 'payload' };
        const nodeB = { id: 2, qualified_name: 'b', extra: 'payload2' };
        const result = mergeResultsRRF([nodeA], [nodeB], 10);
        // Same object references are returned (under `.node`), not copies.
        expect(result.map(e => e.node)).toContain(nodeA);
        expect(result.map(e => e.node)).toContain(nodeB);
        expect(result.find(e => e.node.id === 1)!.node).toBe(nodeA);
    });
});

describe('escapeXml', () => {
    it('escapes each XML special character individually', () => {
        expect(escapeXml('&')).toBe('&amp;');
        expect(escapeXml('<')).toBe('&lt;');
        expect(escapeXml('>')).toBe('&gt;');
        expect(escapeXml('"')).toBe('&quot;');
    });

    it('escapes every occurrence (global /g flag)', () => {
        expect(escapeXml('a<b<c')).toBe('a&lt;b&lt;c');
        expect(escapeXml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
    });

    it('applies `&`-first ordering so entities are NOT double-escaped', () => {
        // `&`->`&amp;` runs first; the `&` it emits must not be re-escaped by a
        // later pass. If `<` were escaped before `&`, the `&` in `&lt;` would
        // become `&amp;lt;`. Assert the single-escape result.
        expect(escapeXml('<&>')).toBe('&lt;&amp;&gt;');
        expect(escapeXml('a&b<c')).toBe('a&amp;b&lt;c');
        // All four together: the literal `&` is escaped once; entities from
        // `<`/`>`/`"` retain their bare `&` prefix (no `&amp;lt;` artifacts).
        expect(escapeXml('&<>"')).toBe('&amp;&lt;&gt;&quot;');
    });

    it('returns a string with no special characters unchanged', () => {
        expect(escapeXml('foo.bar.baz')).toBe('foo.bar.baz');
        expect(escapeXml('')).toBe('');
    });
});

describe('escapeDot', () => {
    it('escapes backslash and double-quote, including a string with both', () => {
        expect(escapeDot('\\')).toBe('\\\\');
        expect(escapeDot('"')).toBe('\\"');
        // Input  C:\path\"quoted\"  -> backslashes doubled, quotes prefixed.
        expect(escapeDot('C:\\path\\"quoted\\"')).toBe('C:\\\\path\\\\\\"quoted\\\\\\"');
    });

    it('escapes every occurrence (global /g flag)', () => {
        expect(escapeDot('""')).toBe('\\"\\"');
        expect(escapeDot('\\\\')).toBe('\\\\\\\\');
    });

    it('returns a string with no special characters unchanged', () => {
        expect(escapeDot('foo.bar.baz')).toBe('foo.bar.baz');
        expect(escapeDot('')).toBe('');
    });
});

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { mergeResultsRRF, requireEngine, EngineNotReadyError, toStructuredResult } from './_utils.js';

export const searchSymbolsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        // M-2 v22: validate schema-required arg `query` before it reaches
        // nodeRepo.searchSymbols(), which calls query.replace(...) and would
        // otherwise TypeError on undefined/non-string input.
        if (typeof args.query !== 'string' || args.query.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: query must be a non-empty string.' }] };
        }
        // P9-2: validate a caller-supplied pre-computed embedding vector. When
        // present it must be a non-empty array of finite numbers, otherwise the
        // downstream vectorRepo.search() would receive garbage / throw.
        if (args.query_embedding !== undefined) {
            if (
                !Array.isArray(args.query_embedding) ||
                args.query_embedding.length === 0 ||
                !args.query_embedding.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
            ) {
                return { isError: true, content: [{ type: 'text', text: 'Invalid argument: query_embedding must be a non-empty array of finite numbers.' }] };
            }
        }
        // P9-2: a pre-computed embedding implies the caller wants semantic
        // results even if `semantic` was not explicitly set to true.
        const useSemantic = args.semantic === true || args.query_embedding !== undefined;
        // O-1/M4: clamp to [1, 200] — negative or zero limits would otherwise
        // reach SQLite as LIMIT -1 (= unlimited).
        const limit = Math.min(Math.max(Math.floor(args.limit) || 10, 1), 200);
        const contexts = deps.workspaceManager.getAllContexts();
        // P9-4: wrap keyword-only nodes with a positional confidence score so
        // every code path produces uniform `{ node, score }` pairs. The top
        // keyword hit scores 1, the next 1/2, then 1/3, ... mirroring the
        // descending-relevance ordering returned by the keyword index.
        const keywordOnly = (nodes: any[]): Array<{ node: any, score: number }> =>
            nodes.map((node, rank) => ({ node, score: 1 / (1 + rank) }));
        const settled = await Promise.allSettled(contexts.map(async (ctx) => {
            const graphEngine = requireEngine(ctx, 'graphEngine');
            const keywordNodes = graphEngine.nodeRepo.searchSymbols(args.query, limit, { symbol_type: args.symbol_type });
            if (!useSemantic) return keywordOnly(keywordNodes);
            try {
                // P9-2: prefer the caller-supplied vector; only fall back to
                // server-side generation when no embedding was passed.
                const queryVector = args.query_embedding
                    ? args.query_embedding
                    : await deps.embeddingProvider.generate(args.query);
                const vectorResults = requireEngine(ctx, 'vectorRepo').search(queryVector, limit);
                const vectorNodes = vectorResults.map(r => graphEngine.getNodeById(r.id)).filter(n => n !== null);
                // P9-4: mergeResultsRRF now returns { node, score } pairs.
                return mergeResultsRRF(keywordNodes, vectorNodes, limit);
            } catch { return keywordOnly(keywordNodes); }
        }));
        const results = settled
            .filter((r): r is PromiseFulfilledResult<Array<{ node: any, score: number }>> => r.status === 'fulfilled')
            .map(r => r.value);
        // O-12: previously allSettled silently dropped EngineNotReadyError
        // rejections, so a search issued while the host is still initializing
        // returned an empty *success* result (indistinguishable from "no
        // matches"). If there are contexts but every one failed to be ready,
        // surface an error instead of a misleading empty result.
        if (results.length === 0 && contexts.length > 0) {
            const rejections = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
            if (rejections.length > 0 && rejections.every(r => r.reason instanceof EngineNotReadyError)) {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Engine is not ready yet — the host is still initializing. Please retry shortly." }]
                };
            }
        }
        const flat = results.flat().slice(0, limit);
        // P9-4: thread the RRF / positional confidence score through to the
        // structured result so agents can judge and filter match quality.
        return { content: [{ type: "text", text: JSON.stringify(flat.map(r => toStructuredResult(r.node, { score: r.score })), null, 2) }] };
    }
};

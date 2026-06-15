/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { mergeResultsRRF, requireEngine, EngineNotReadyError } from './_utils.js';

export const searchSymbolsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        // M-2 v22: validate schema-required arg `query` before it reaches
        // nodeRepo.searchSymbols(), which calls query.replace(...) and would
        // otherwise TypeError on undefined/non-string input.
        if (typeof args.query !== 'string' || args.query.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: query must be a non-empty string.' }] };
        }
        // O-1/M4: clamp to [1, 200] — negative or zero limits would otherwise
        // reach SQLite as LIMIT -1 (= unlimited).
        const limit = Math.min(Math.max(Math.floor(args.limit) || 10, 1), 200);
        const contexts = deps.workspaceManager.getAllContexts();
        const settled = await Promise.allSettled(contexts.map(async (ctx) => {
            const graphEngine = requireEngine(ctx, 'graphEngine');
            const keywordNodes = graphEngine.nodeRepo.searchSymbols(args.query, limit, { symbol_type: args.symbol_type });
            if (!args.semantic) return keywordNodes;
            try {
                const queryVector = await deps.embeddingProvider.generate(args.query);
                const vectorResults = requireEngine(ctx, 'vectorRepo').search(queryVector, limit);
                const vectorNodes = vectorResults.map(r => graphEngine.getNodeById(r.id)).filter(n => n !== null);
                return mergeResultsRRF(keywordNodes, vectorNodes, limit);
            } catch { return keywordNodes; }
        }));
        const results = settled
            .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
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
        return { content: [{ type: "text", text: JSON.stringify(flat.map(n => ({ qname: n.qualified_name, type: n.symbol_type, file: n.file_path, tags: n.tags })), null, 2) }] };
    }
};

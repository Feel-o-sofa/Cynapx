/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { mergeResultsRRF } from './_utils.js';

export const searchSymbolsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const limit = args.limit || 10;
        const settled = await Promise.allSettled(deps.workspaceManager.getAllContexts().map(async (ctx) => {
            const keywordNodes = ctx.graphEngine!.nodeRepo.searchSymbols(args.query, limit, { symbol_type: args.symbol_type });
            if (!args.semantic) return keywordNodes;
            try {
                const queryVector = await deps.embeddingProvider.generate(args.query);
                const vectorResults = ctx.vectorRepo!.search(queryVector, limit);
                const vectorNodes = vectorResults.map(r => ctx.graphEngine!.getNodeById(r.id)).filter(n => n !== null);
                return mergeResultsRRF(keywordNodes, vectorNodes, limit);
            } catch { return keywordNodes; }
        }));
        const results = settled
            .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
            .map(r => r.value);
        const flat = results.flat().slice(0, limit);
        return { content: [{ type: "text", text: JSON.stringify(flat.map(n => ({ qname: n.qualified_name, type: n.symbol_type, file: n.file_path, tags: n.tags })), null, 2) }] };
    }
};

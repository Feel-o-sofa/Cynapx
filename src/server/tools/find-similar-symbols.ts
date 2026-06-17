/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { toStructuredResult, StructuredSymbolResult } from './_utils.js';

export const findSimilarSymbolsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        // Validate qualified_name
        if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
        }

        // Resolve active context
        const ctx = deps.getContext();
        if (!ctx || !ctx.graphEngine) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }
        if (!ctx.vectorRepo) {
            return { isError: true, content: [{ type: 'text', text: 'Vector search is unavailable for the active project (no vector repository).' }] };
        }

        // Clamp limit to [1, 100], default 10
        const rawLimit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 10;
        const limit = Math.max(1, Math.min(100, rawLimit));

        // Look up the query node
        const node = ctx.graphEngine.nodeRepo.getNodeByQualifiedName(args.qualified_name);
        if (!node || node.id === undefined || node.id === null) {
            return { isError: true, content: [{ type: 'text', text: `Symbol not found: ${args.qualified_name}` }] };
        }
        const nodeId: number = node.id;

        // Retrieve the node's stored embedding
        const embedding = ctx.vectorRepo.getEmbedding(nodeId);
        if (!embedding) {
            return {
                content: [{
                    type: 'text',
                    text: `No embedding is available for symbol "${args.qualified_name}". Semantic similarity search requires embeddings, which may not have been generated for this symbol.`
                }]
            };
        }

        // K-NN search. Request limit + 1 because the query node itself will
        // appear in its own neighborhood and must be filtered out.
        const searchResults = ctx.vectorRepo.search(embedding, limit + 1);

        const similar = searchResults
            .filter(r => r.id !== nodeId)
            .slice(0, limit)
            .map(r => {
                const n = ctx.graphEngine!.getNodeById(r.id);
                if (!n) return null;
                // Normalized similarity score in (0, 1]; higher is more similar.
                const score = 1 / (1 + r.distance);
                return toStructuredResult(n, { score });
            })
            .filter((n): n is StructuredSymbolResult => n !== null);

        return { content: [{ type: 'text', text: JSON.stringify(similar, null, 2) }] };
    }
};

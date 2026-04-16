/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const analyzeImpactHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        // M-4: validate args.qualified_name is a string
        if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
        }
        // C-1: null guard for context
        const ctx = deps.getContext();
        if (!ctx || !ctx.graphEngine) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }
        const node = ctx.graphEngine.getNodeByQualifiedName(args.qualified_name);
        if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
        const depth = Math.min(typeof args.max_depth === 'number' && !Number.isNaN(args.max_depth) ? args.max_depth : 5, 20);
        const results = ctx.graphEngine.traverse(node.id!, 'BFS', { direction: 'incoming', maxDepth: depth, useCache: args.use_cache });
        const formatted = results.map(r => ({
            node: r.node.qualified_name,
            distance: r.distance,
            impact_path: r.path.map(step => ctx.graphEngine!.getNodeById(step.nodeId)?.qualified_name).reverse().join(' -> ')
        }));
        return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
    }
};

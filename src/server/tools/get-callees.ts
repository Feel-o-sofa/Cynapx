/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const getCalleesHandler: ToolHandler = {
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
        // M-3: use JOIN query to avoid N+1 getNodeById calls
        const callees = ctx.graphEngine.getOutgoingEdgesWithCalleeNames(node.id!);
        return { content: [{ type: "text", text: JSON.stringify(callees.map(r => ({ qname: r.qualified_name, line: r.call_site_line })), null, 2) }] };
    }
};

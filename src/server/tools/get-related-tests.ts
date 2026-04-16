/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { toCanonical } from '../../utils/paths.js';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const getRelatedTestsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        if (!args.qualified_name) {
            return { content: [{ type: 'text', text: 'Error: qualified_name is required.' }], isError: true };
        }
        const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
        if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };

        // 1. Direct tests edges pointing to this node
        const directTests = ctx.graphEngine!.getIncomingEdges(node.id!)
            .filter(e => e.edge_type === 'tests')
            .map(e => ctx.graphEngine!.getNodeById(e.from_id)?.qualified_name)
            .filter((q): q is string => q != null);

        // 2. File-level tests edges (test file → production file that contains this symbol)
        let fileTests: string[] = [];
        if (node.symbol_type !== 'file') {
            const fileQname = toCanonical(node.file_path);
            const fileNode = ctx.graphEngine!.getNodeByQualifiedName(fileQname);
            if (fileNode) {
                fileTests = ctx.graphEngine!.getIncomingEdges(fileNode.id!)
                    .filter(e => e.edge_type === 'tests')
                    .map(e => ctx.graphEngine!.getNodeById(e.from_id)?.qualified_name)
                    .filter((q): q is string => q != null);
            }
        }

        const allTests = [...new Set([...directTests, ...fileTests])];
        return { content: [{ type: "text", text: JSON.stringify(allTests, null, 2) }] };
    }
};

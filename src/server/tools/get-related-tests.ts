/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { toCanonical } from '../../utils/paths.js';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { requireEngine } from './_utils.js';

export const getRelatedTestsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
        }
        const graphEngine = requireEngine(ctx, 'graphEngine');
        const node = graphEngine.getNodeByQualifiedName(args.qualified_name);
        if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };

        // 1. Direct tests edges pointing to this node
        const directTests = graphEngine.getIncomingEdges(node.id!)
            .filter(e => e.edge_type === 'tests')
            .map(e => graphEngine.getNodeById(e.from_id)?.qualified_name)
            .filter((q): q is string => q != null);

        // 2. File-level tests edges (test file → production file that contains this symbol)
        let fileTests: string[] = [];
        let fileQname: string | undefined;
        if (node.symbol_type !== 'file') {
            fileQname = toCanonical(node.file_path);
            const fileNode = graphEngine.getNodeByQualifiedName(fileQname);
            if (fileNode) {
                fileTests = graphEngine.getIncomingEdges(fileNode.id!)
                    .filter(e => e.edge_type === 'tests')
                    .map(e => graphEngine.getNodeById(e.from_id)?.qualified_name)
                    .filter((q): q is string => q != null);
            }
        }

        const allTests = [...new Set([...directTests, ...fileTests])];

        // P7: behavioral contracts — the captured it()/test() specs and their
        // expect() assertions linked to this symbol (and to its file-level qname).
        const db = graphEngine.nodeRepo.getDb();
        const specs = db.prepare(
            'SELECT title, assertions, file_path, start_line FROM test_specs WHERE target_qname = ?'
        ).all(args.qualified_name) as { title: string; assertions: string; file_path: string; start_line: number }[];

        if (node.symbol_type !== 'file') {
            const fileSpecs = db.prepare(
                'SELECT title, assertions, file_path, start_line FROM test_specs WHERE target_qname = ?'
            ).all(fileQname ?? '') as { title: string; assertions: string; file_path: string; start_line: number }[];
            specs.push(...fileSpecs);
        }

        const allSpecs = specs.map(s => ({
            title: s.title,
            assertions: JSON.parse(s.assertions) as string[],
            location: `${s.file_path}:${s.start_line}`
        }));

        return { content: [{ type: "text", text: JSON.stringify({ tests: allTests, specs: allSpecs }, null, 2) }] };
    }
};

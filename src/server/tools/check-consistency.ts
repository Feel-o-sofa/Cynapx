/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ConsistencyChecker } from '../../indexer/consistency-checker.js';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const checkConsistencyHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        const checker = new ConsistencyChecker(ctx.graphEngine!.nodeRepo, ctx.gitService!, ctx.updatePipeline!, ctx.projectPath);
        const results = await checker.validate(args.repair, args.force);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
};

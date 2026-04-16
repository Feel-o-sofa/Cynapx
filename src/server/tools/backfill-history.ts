/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const backfillHistoryHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        // H-6: Terminal mode guard — long-running operations unavailable in Terminal mode
        if (deps.isTerminal()) {
            return { content: [{ type: 'text', text: 'This operation is not available in Terminal mode.' }], isError: true };
        }
        const pipeline = ctx.updatePipeline!;
        await pipeline.mapHistoryToProject();
        return { content: [{ type: "text", text: "Successfully backfilled Git history." }] };
    }
};

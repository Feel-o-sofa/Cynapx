/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { requireEngine } from './_utils.js';
import { ProgressReporter, NOOP_PROGRESS } from './_progress.js';

export const backfillHistoryHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps, progress: ProgressReporter = NOOP_PROGRESS): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        // H-6: Terminal mode guard — long-running operations unavailable in Terminal mode
        if (deps.isTerminal()) {
            return { content: [{ type: 'text', text: 'This operation is not available in Terminal mode.' }], isError: true };
        }
        const pipeline = requireEngine(ctx, 'updatePipeline');
        // A-4 (Phase 14-5): coarse progress (no token => no-op).
        await progress.report(0, 1, 'Walking Git history');
        await pipeline.mapHistoryToProject();
        await progress.report(1, 1, 'Git history backfilled');
        return { content: [{ type: "text", text: "Successfully backfilled Git history." }] };
    }
};

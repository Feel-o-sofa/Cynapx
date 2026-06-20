/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { requireEngine } from './_utils.js';
import { ProgressReporter, NOOP_PROGRESS } from './_progress.js';

export const reTagProjectHandler: ToolHandler = {
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
        await progress.report(0, 1, 'Re-tagging all nodes');
        await pipeline.reTagAllNodes();
        await progress.report(1, 1, 'Re-tagging complete');
        return { content: [{ type: "text", text: "Successfully re-tagged all nodes." }] };
    }
};

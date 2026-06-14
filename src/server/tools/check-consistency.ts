/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ConsistencyChecker } from '../../indexer/consistency-checker.js';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { requireEngine } from './_utils.js';
import { ProgressReporter, NOOP_PROGRESS } from './_progress.js';

export const checkConsistencyHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps, progress: ProgressReporter = NOOP_PROGRESS): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        const checker = new ConsistencyChecker(
            requireEngine(ctx, 'graphEngine').nodeRepo,
            requireEngine(ctx, 'gitService'),
            requireEngine(ctx, 'updatePipeline'),
            ctx.projectPath
        );
        // A-4 (Phase 14-5): coarse progress (no token => no-op).
        await progress.report(0, 1, 'Reconciling graph against disk and Git');
        const results = await checker.validate(args.repair, args.force);
        await progress.report(1, 1, 'Consistency check complete');
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
};

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const getRiskProfileHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
            return { content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }], isError: true };
        }
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        const profile = await ctx.refactorEngine!.getRiskProfile(args.qualified_name);
        return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
    }
};

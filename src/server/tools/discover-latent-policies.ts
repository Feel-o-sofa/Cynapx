/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const discoverLatentPoliciesHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        if (args.min_confidence !== undefined && (typeof args.min_confidence !== 'number' || Number.isNaN(args.min_confidence) || args.min_confidence < 0 || args.min_confidence > 1)) {
            return { content: [{ type: 'text', text: 'Invalid argument: min_confidence must be a number between 0 and 1.' }], isError: true };
        }
        if (args.max_policies !== undefined && (typeof args.max_policies !== 'number' || Number.isNaN(args.max_policies) || args.max_policies < 1 || !Number.isInteger(args.max_policies))) {
            return { content: [{ type: 'text', text: 'Invalid argument: max_policies must be a positive integer.' }], isError: true };
        }
        const policies = await ctx.policyDiscoverer!.discoverPolicies(args.threshold, args.min_count);
        return { content: [{ type: "text", text: JSON.stringify(policies, null, 2) }] };
    }
};

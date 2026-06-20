/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { requireEngine } from './_utils.js';

export const discoverLatentPoliciesHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        if (args.threshold !== undefined && (typeof args.threshold !== 'number' || Number.isNaN(args.threshold) || args.threshold < 0 || args.threshold > 1)) {
            return { content: [{ type: 'text', text: 'Invalid argument: threshold must be a number between 0 and 1.' }], isError: true };
        }
        if (args.min_count !== undefined && (typeof args.min_count !== 'number' || Number.isNaN(args.min_count) || args.min_count < 1 || !Number.isInteger(args.min_count))) {
            return { content: [{ type: 'text', text: 'Invalid argument: min_count must be a positive integer.' }], isError: true };
        }
        const policies = await requireEngine(ctx, 'policyDiscoverer').discoverPolicies(args.threshold, args.min_count);
        return { content: [{ type: "text", text: JSON.stringify(policies, null, 2) }] };
    }
};

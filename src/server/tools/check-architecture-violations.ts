/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { requireEngine } from './_utils.js';

export const checkArchitectureViolationsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        const archEngine = requireEngine(ctx, 'archEngine');
        const violations = await archEngine.checkViolations();
        const customRulesLoaded = archEngine.hasCustomRules;
        return { content: [{ type: "text", text: JSON.stringify({ violations, customRulesLoaded }, null, 2) }] };
    }
};

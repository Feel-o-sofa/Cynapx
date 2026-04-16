/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const getRemediationStrategyHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        if (!args.violation) {
            return { isError: true, content: [{ type: "text", text: "Missing required argument: violation" }] };
        }
        if (!args.violation.source || !args.violation.target) {
            return { isError: true, content: [{ type: "text", text: "Invalid violation object: 'source' and 'target' nodes are required. Pass a violation object returned by check_architecture_violations." }] };
        }
        const strategy = deps.remediationEngine.getRemediationStrategy(args.violation);
        return { content: [{ type: "text", text: JSON.stringify(strategy, null, 2) }] };
    }
};

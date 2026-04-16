/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';

export interface ToolResult {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}

export interface ToolHandler {
    execute(args: any, deps: ToolDeps): Promise<ToolResult>;
}

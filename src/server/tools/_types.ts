/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ProgressReporter } from './_progress.js';

export interface ToolResult {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}

export interface ToolHandler {
    /**
     * `progress` is an optional ProgressReporter (A-4 / Phase 14-5). Handlers
     * that omit the parameter are unaffected; long-running handlers call
     * `progress.report(...)` at stage boundaries. It is always safe to call —
     * when the caller provided no progress token it is a no-op reporter.
     */
    execute(args: any, deps: ToolDeps, progress?: ProgressReporter): Promise<ToolResult>;
}

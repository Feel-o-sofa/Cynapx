/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { readRegistry } from '../../utils/paths.js';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const getSetupContextHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const registry = readRegistry();
        const setupCtx = deps.getContext();
        return { content: [{ type: "text", text: JSON.stringify({ status: deps.getIsInitialized() ? "ALREADY_INITIALIZED" : "INITIALIZATION_REQUIRED", current_path: process.cwd(), registered_projects: registry, embeddings: setupCtx?.updatePipeline?.embeddingsAvailable ? 'enabled' : 'disabled' }, null, 2) }] };
    }
};

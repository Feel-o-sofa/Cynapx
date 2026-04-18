/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { readRegistry, getCentralStorageDir, getDirSizeMB, DISK_THRESHOLD_MB } from '../../utils/paths.js';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const getSetupContextHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const registry = readRegistry();
        const setupCtx = deps.getContext();
        const storageDir = getCentralStorageDir();
        const diskUsageMB = Math.round(getDirSizeMB(storageDir) * 10) / 10;
        const diskWarning = diskUsageMB >= DISK_THRESHOLD_MB
            ? `~/.cynapx directory is using ${diskUsageMB.toFixed(1)} MB (threshold: ${DISK_THRESHOLD_MB} MB). Run \`cynapx-admin compact --yes\` to reclaim space.`
            : undefined;

        const payload: Record<string, unknown> = {
            status: deps.getIsInitialized() ? 'ALREADY_INITIALIZED' : 'INITIALIZATION_REQUIRED',
            current_path: process.cwd(),
            registered_projects: registry,
            embeddings: setupCtx?.updatePipeline?.embeddingsAvailable ? 'enabled' : 'disabled',
            disk_usage_mb: diskUsageMB,
        };
        if (diskWarning) payload['disk_warning'] = diskWarning;

        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    }
};

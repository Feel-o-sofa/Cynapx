/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import { getDatabasePath, removeFromRegistry } from '../../utils/paths.js';
import { getAuditLogger } from '../../utils/audit-logger.js';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const purgeIndexHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        if (!args.confirm) return { content: [{ type: "text", text: "WARNING: This deletes all index data. Confirm with 'confirm: true'" }] };
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        const dbPath = getDatabasePath(ctx.projectPath);
        // H-6: onPurge wires WorkspaceManager.unmountProject(hash) — it disposes
        // the watcher/worker-pool/dbManager in order and nulls every engine
        // field so no closed-handle reference survives and re-initialization is
        // not short-circuited by a disposed-but-non-null dbManager. Fall back to
        // a bare dbManager dispose only when onPurge is unwired (e.g. tests).
        if (deps.onPurge) {
            await deps.onPurge(ctx.projectHash);
        } else {
            ctx.dbManager?.dispose();
            ctx.dbManager = undefined;
        }
        deps.setIsInitialized(false);
        [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
        const auditPurge = getAuditLogger();
        if (args.unregister) {
            removeFromRegistry(ctx.projectPath);
            auditPurge.log('unregister', { project: ctx.projectPath });
        }
        auditPurge.log('purge', { project: ctx.projectPath });
        return { content: [{ type: "text", text: "Project index purged successfully. Server in PENDING mode." }] };
    }
};

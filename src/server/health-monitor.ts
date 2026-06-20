/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { WorkspaceManager } from './workspace-manager';
import { ConsistencyChecker } from '../indexer/consistency-checker';
import { requireEngine } from './tools/_utils';
import { Logger } from '../utils/logger';


const log = new Logger('HealthMonitor');
/**
 * HealthMonitor runs a periodic consistency check on the active project's
 * knowledge graph and triggers auto-repair when inconsistencies are detected.
 *
 * L-7: The interval handle is stored so it can be cleared on stop(),
 * guaranteeing cleanup when the MCP session ends.
 */
export class HealthMonitor {
    private interval?: NodeJS.Timeout;
    private isChecking = false;

    start(workspaceManager: WorkspaceManager): void {
        this.interval = setInterval(async () => {
            if (this.isChecking) return;
            try {
                const ctx = workspaceManager.getActiveContext();
                if (!ctx) return;

                const stats = requireEngine(ctx, 'metadataRepo').getLedgerStats();
                const isConsistent =
                    stats.metadata.total_calls_count === stats.actual.sum_fan_in &&
                    stats.metadata.total_calls_count === stats.actual.sum_fan_out;

                if (!isConsistent) {
                    log.error("[HealthMonitor] Ledger inconsistency detected. Triggering auto-repair...");
                    this.isChecking = true;
                    try {
                        const checker = new ConsistencyChecker(
                            requireEngine(ctx, 'graphEngine').nodeRepo,
                            requireEngine(ctx, 'gitService'),
                            requireEngine(ctx, 'updatePipeline'),
                            ctx.projectPath
                        );
                        await checker.validate(true, false);
                    } finally {
                        this.isChecking = false;
                    }
                }
            } catch (e) { log.error('[HealthMonitor] Check failed:', { detail: e }); }
        }, 5 * 60 * 1000);
    }

    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }
}

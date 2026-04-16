/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

const ALLOWED_METRICS = ['cyclomatic', 'fan_in', 'fan_out', 'loc'] as const;
type AllowedMetric = typeof ALLOWED_METRICS[number];

export const getHotspotsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        // M-4: validate metric type and threshold type
        if (typeof args.metric !== 'string') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: metric must be a string.' }] };
        }
        if (!ALLOWED_METRICS.includes(args.metric as AllowedMetric)) {
            return { isError: true, content: [{ type: 'text', text: `Invalid metric '${args.metric}'. Allowed values: ${ALLOWED_METRICS.join(', ')}` }] };
        }
        if (args.threshold !== undefined && (typeof args.threshold !== 'number' || Number.isNaN(args.threshold))) {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: threshold must be a number.' }] };
        }
        // C-1: null guard for context
        const ctx = deps.getContext();
        if (!ctx || !ctx.dbManager) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }
        const db = ctx.dbManager.getDb();
        const hotspots = db.prepare(`SELECT qualified_name, symbol_type, ${args.metric} FROM nodes WHERE ${args.metric} >= ? ORDER BY ${args.metric} DESC LIMIT 20`).all(args.threshold || 0);
        return { content: [{ type: "text", text: JSON.stringify(hotspots, null, 2) }] };
    }
};

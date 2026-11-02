/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { requireEngine } from './_utils.js';

/** LOW-tier entries listed; the rest are counted. */
const LOW_LIST_LIMIT = 30;

export const findDeadCodeHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        const report = await requireEngine(ctx, 'optEngine').findDeadCode();
        const totalDead = report.summary.deadSymbols;
        const list = (nodes: typeof report.high, limit = Infinity) => nodes.slice(0, limit)
            .map(node => `  - ${node.qualified_name} [${node.symbol_type}] (${node.file_path}:${node.start_line})\n`).join('');

        let text = `Found ${totalDead} functions and methods that nothing calls or names:\n`;
        text += `- HIGH confidence (private): ${report.summary.highConfidenceDead}\n`;
        text += `- MEDIUM confidence (internal by convention, e.g. _name or protected): ${report.summary.mediumConfidenceDead}\n`;
        text += `- LOW confidence (public; may be external API or a registered callback): ${report.summary.lowConfidenceDead}\n`;
        text += `\nAnalyzed ${report.summary.totalSymbols} functions and methods | Share without callers: ${report.summary.optimizationPotential}\n`;
        text += `Not analyzed: ${report.summary.notAnalyzed} other symbols (data assets such as JSON/YAML keys and Markdown sections, fields, imports, types) — call fan-in cannot show them unused.\n`;
        text += `Set aside: ${report.summary.referencedByName} more have no callers but their name occurs elsewhere in the project (callbacks, decorators, aliases, config entries, dynamic dispatch).\n`;
        text += `Excluded as called implicitly: constructors, __dunder__ methods, init/main, decorated or annotated definitions, overrides, local functions, test files. Names built at runtime (e.g. getattr(obj, 'handle_' + kind)) cannot be seen, so verify before deleting.\n`;

        if (report.high.length > 0) text += `\nHIGH confidence (review first):\n${list(report.high)}`;
        if (report.medium.length > 0) text += `\nMEDIUM confidence:\n${list(report.medium)}`;
        if (report.low.length > 0) {
            const shown = Math.min(report.low.length, LOW_LIST_LIMIT);
            text += `\nLOW confidence (${shown} of ${report.low.length} shown):\n${list(report.low, LOW_LIST_LIMIT)}`;
        }

        return { content: [{ type: "text", text }] };
    }
};

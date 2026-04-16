/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const findDeadCodeHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }
        const report = await ctx.optEngine!.findDeadCode();
        const totalDead = report.summary.deadSymbols;
        let text = `Found ${totalDead} potential dead code symbols:\n`;
        text += `- HIGH confidence (private, fan_in=0): ${report.summary.highConfidenceDead} symbols\n`;
        text += `- MEDIUM confidence (public, trait:internal, fan_in=0): ${report.summary.mediumConfidenceDead} symbols\n`;
        text += `- LOW confidence (public, fan_in=0, may be external API): ${report.summary.lowConfidenceDead} symbols\n`;
        text += `\nTotal symbols analyzed: ${report.summary.totalSymbols} | Optimization potential: ${report.summary.optimizationPotential}\n`;

        if (report.high.length > 0) {
            text += `\nHIGH confidence (review first):\n`;
            report.high.forEach(node => {
                text += `  - ${node.qualified_name} [${node.symbol_type}] (${node.file_path}:${node.start_line})\n`;
            });
        }

        if (report.medium.length > 0) {
            text += `\nMEDIUM confidence:\n`;
            report.medium.forEach(node => {
                text += `  - ${node.qualified_name} [${node.symbol_type}] (${node.file_path}:${node.start_line})\n`;
            });
        }

        // LOW confidence: count only, list omitted (high FP rate)
        if (report.low.length > 0) {
            text += `\nLOW confidence: ${report.low.length} symbols (list omitted — high false-positive rate, likely external API surface)\n`;
        }

        return { content: [{ type: "text", text }] };
    }
};

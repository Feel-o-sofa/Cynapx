/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const getSymbolHistoryHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
        }

        const ctx = deps.getContext();
        if (!ctx || !ctx.graphEngine) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }

        const node = ctx.graphEngine.getNodeByQualifiedName(args.qualified_name);
        if (!node) {
            return { isError: true, content: [{ type: 'text', text: `Symbol not found: ${args.qualified_name}` }] };
        }

        const history = node.history;
        if (!history || history.length === 0) {
            return { content: [{ type: 'text', text: `## History: \`${node.qualified_name}\`\n\nNo history recorded. Run \`backfill_history\` first to populate commit history.` }] };
        }

        let text = `## History: \`${node.qualified_name}\`\n\n`;
        for (const commit of history) {
            const shortHash = commit.hash.substring(0, 7);
            text += `- **[${shortHash}]** "${commit.message}" — ${commit.author} (${commit.date})\n`;
        }

        const mostRecent = history[0];
        text += `\n**Intent summary**: This symbol has been modified ${history.length} time${history.length === 1 ? '' : 's'}. Most recent change: "${mostRecent.message}".\n`;

        return { content: [{ type: 'text', text }] };
    }
};

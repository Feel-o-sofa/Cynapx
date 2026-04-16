/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const getSymbolDetailsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        // M-4: validate args.qualified_name is a string
        if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
        }
        // C-1: null guard for context
        const ctx = deps.getContext();
        if (!ctx || !ctx.graphEngine) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }
        const node = ctx.graphEngine.getNodeByQualifiedName(args.qualified_name);
        if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };

        if (args.summary_only) return { content: [{ type: "text", text: JSON.stringify({ qname: node.qualified_name, type: node.symbol_type, metrics: { loc: node.loc, cyclomatic: node.cyclomatic, fan_in: node.fan_in, fan_out: node.fan_out } }, null, 2) }] };

        let text = `### Symbol: ${node.qualified_name}\n`;
        text += `- **Type**: ${node.symbol_type}\n`;
        if (node.signature) text += `- **Signature**: ${node.signature}\n`;
        text += `- **File**: ${node.file_path} (line ${node.start_line}-${node.end_line})\n`;

        // L-2: tags is always string[] | undefined per type definition — Array.isArray branch removed
        if (node.tags && node.tags.length > 0) {
            text += `- **Structural Tags**: ${node.tags.join(', ')}\n`;
        }

        if (node.history && node.history.length > 0) {
            text += `\n#### Historical Evidence:\n`;
            node.history.slice(0, 3).forEach(commit => {
                text += `- **[${commit.hash.substring(0, 7)}]** ${commit.message} (by ${commit.author})\n`;
            });
        }

        text += `\n#### Metrics:\n- LOC: ${node.loc}, CC: ${node.cyclomatic}\n- Static Coupling: Fan-in: ${node.fan_in || 0}, Fan-out: ${node.fan_out || 0}\n`;

        if (args.include_source !== false) {
            if (!ctx.securityProvider) {
                text += '\n\n> [!WARNING] Source code unavailable: security provider not initialized.';
            } else {
                try {
                    ctx.securityProvider.validatePath(node.file_path);
                    const content = fs.readFileSync(node.file_path, 'utf8').split('\n');
                    // M-6: validate start_line/end_line before slicing
                    if (node.start_line < 1 || node.end_line < node.start_line) {
                        text += '\n> [!WARNING] Invalid line range in database record.';
                    } else {
                        const snippet = content.slice(node.start_line - 1, node.end_line);
                        const display = snippet.length > 100 ?
                            snippet.slice(0, 50).join('\n') + "\n\n// ... [Truncated for Token Optimization: Use read_file for full content] ..." :
                            snippet.join('\n');
                        text += '\n#### Source Code Snippet:\n```\n' + display + '\n```\n';
                    }
                } catch (e: any) {
                    // L-1: distinguish ENOENT vs EACCES
                    const reason = e.code === 'ENOENT' ? 'File not found'
                        : e.code === 'EACCES' ? 'Permission denied'
                        : String(e);
                    text += `\n> [!WARNING] Source unavailable: ${reason}`;
                }
            }
        }
        return { content: [{ type: "text", text }] };
    }
};

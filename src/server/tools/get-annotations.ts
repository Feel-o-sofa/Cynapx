/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

const VALID_KINDS = ['decision', 'gotcha', 'todo', 'rationale'];

interface AnnotationRow {
    id: number;
    node_qname: string;
    kind: string;
    body: string;
    author: string;
    created_at: number;
    commit_hash: string | null;
}

export const getAnnotationsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx || !ctx.graphEngine) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }

        // Resolve limit (default 20)
        let limit = 20;
        if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
            limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
        }

        const hasQname = typeof args.qualified_name === 'string' && args.qualified_name.trim() !== '';
        const hasKind = typeof args.kind === 'string' && args.kind.trim() !== '';

        if (hasKind && !VALID_KINDS.includes(args.kind)) {
            return { isError: true, content: [{ type: 'text', text: `Invalid argument: kind must be one of ${VALID_KINDS.join(', ')}.` }] };
        }

        const db = ctx.graphEngine.nodeRepo.getDb();

        const conditions: string[] = [];
        const params: any[] = [];
        if (hasQname) {
            conditions.push('node_qname = ?');
            params.push(args.qualified_name);
        }
        if (hasKind) {
            conditions.push('kind = ?');
            params.push(args.kind);
        }
        const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
        params.push(limit);

        const rows = db.prepare(
            `SELECT id, node_qname, kind, body, author, created_at, commit_hash FROM annotations${where} ORDER BY created_at DESC LIMIT ?`
        ).all(...params) as AnnotationRow[];

        if (rows.length === 0) {
            return { content: [{ type: 'text', text: 'No annotations found. Use `add_annotation` to record decisions, gotchas, todos, or rationale.' }] };
        }

        const title = hasQname ? `## Annotations for \`${args.qualified_name}\`` : `## Recent Annotations`;
        let text = `${title}\n`;
        for (const a of rows) {
            const date = new Date(a.created_at * 1000).toISOString().slice(0, 10);
            text += `\n### [${a.kind}] by ${a.author} (${date})\n`;
            if (!hasQname) {
                text += `\`${a.node_qname}\`\n`;
            }
            text += `${a.body}\n`;
        }

        return { content: [{ type: 'text', text }] };
    }
};

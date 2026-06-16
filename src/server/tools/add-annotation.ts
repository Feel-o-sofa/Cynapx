/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

const VALID_KINDS = ['decision', 'gotcha', 'todo', 'rationale'];

export const addAnnotationHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        // Validate qualified_name
        if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
        }
        // Validate kind
        if (typeof args.kind !== 'string' || !VALID_KINDS.includes(args.kind)) {
            return { isError: true, content: [{ type: 'text', text: `Invalid argument: kind must be one of ${VALID_KINDS.join(', ')}.` }] };
        }
        // Validate body
        if (typeof args.body !== 'string' || args.body.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: body must be a non-empty string.' }] };
        }

        const author = (typeof args.author === 'string' && args.author.trim() !== '') ? args.author : 'agent';

        const ctx = deps.getContext();
        if (!ctx || !ctx.graphEngine) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }

        const db = ctx.graphEngine.nodeRepo.getDb();

        // Check the node exists
        const existing = db.prepare('SELECT id FROM nodes WHERE qualified_name = ?').get(args.qualified_name);
        if (!existing) {
            return { isError: true, content: [{ type: 'text', text: `Symbol not found: ${args.qualified_name}. The annotation was not saved.` }] };
        }

        db.prepare(
            'INSERT INTO annotations (node_qname, kind, body, author) VALUES (?, ?, ?, ?)'
        ).run(args.qualified_name, args.kind, args.body, author);

        const preview = args.body.slice(0, 50);
        return { content: [{ type: 'text', text: `Annotation added to \`${args.qualified_name}\`: [${args.kind}] ${preview}` }] };
    }
};

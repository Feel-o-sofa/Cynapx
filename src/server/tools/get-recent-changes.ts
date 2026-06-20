/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

interface CommitEntry {
    hash: string;
    message: string;
    author: string;
    date: string;
}

interface NodeRow {
    qualified_name: string;
    symbol_type: string;
    language: string;
    file_path: string;
    history: string;
}

export const getRecentChangesHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx || !ctx.graphEngine) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }

        // Resolve limit (default 20, max 50)
        let limit = 20;
        if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
            limit = Math.max(1, Math.min(50, Math.floor(args.limit)));
        }

        // Optional since_days filter
        let cutoffMs: number | null = null;
        if (typeof args.since_days === 'number' && Number.isFinite(args.since_days) && args.since_days > 0) {
            cutoffMs = Date.now() - args.since_days * 24 * 60 * 60 * 1000;
        }

        const db = ctx.graphEngine.nodeRepo.getDb();
        const rows = db.prepare(
            "SELECT qualified_name, symbol_type, language, file_path, history FROM nodes WHERE history IS NOT NULL AND history != '[]'"
        ).all() as NodeRow[];

        // Map of hash -> commit info + changed nodes
        const commits = new Map<string, {
            info: CommitEntry;
            nodes: { qualified_name: string; symbol_type: string }[];
        }>();

        for (const row of rows) {
            let history: CommitEntry[];
            try {
                history = JSON.parse(row.history);
            } catch {
                continue;
            }
            if (!Array.isArray(history)) continue;

            for (const commit of history) {
                if (!commit || typeof commit.hash !== 'string') continue;

                if (cutoffMs !== null) {
                    const t = Date.parse(commit.date);
                    if (!Number.isNaN(t) && t < cutoffMs) continue;
                }

                let entry = commits.get(commit.hash);
                if (!entry) {
                    entry = { info: commit, nodes: [] };
                    commits.set(commit.hash, entry);
                }
                entry.nodes.push({ qualified_name: row.qualified_name, symbol_type: row.symbol_type });
            }
        }

        // Sort by date descending
        const sorted = Array.from(commits.values()).sort((a, b) => {
            const ta = Date.parse(a.info.date) || 0;
            const tb = Date.parse(b.info.date) || 0;
            return tb - ta;
        }).slice(0, limit);

        if (sorted.length === 0) {
            return { content: [{ type: 'text', text: 'No recent changes found. Run `backfill_history` first to populate commit history.' }] };
        }

        let text = `## Recent Changes\n`;
        for (const c of sorted) {
            const shortHash = c.info.hash.substring(0, 7);
            const dateStr = (c.info.date || '').slice(0, 10);
            text += `\n### [${shortHash}] "${c.info.message}" — ${c.info.author} (${dateStr})\n`;
            for (const n of c.nodes) {
                text += `- \`${n.qualified_name}\` (${n.symbol_type})\n`;
            }
        }

        return { content: [{ type: 'text', text }] };
    }
};

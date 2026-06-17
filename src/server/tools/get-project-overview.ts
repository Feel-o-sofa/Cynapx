/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

/**
 * get_project_overview — the "front door" for an AI agent entering an unfamiliar
 * codebase. Returns a token-efficient markdown briefing: project identity, tech
 * stack, scale, architecture layers, entry points, hotspots, semantic clusters,
 * and documentation section headers.
 */
export const getProjectOverviewHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx || !ctx.graphEngine) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }

        const db = ctx.graphEngine.nodeRepo.db;
        const includeClusters = args?.include_clusters !== false;

        // 1. Project metadata from package.json (best-effort)
        let projectMeta = '';
        try {
            const projectRoot = ctx.projectPath;
            if (projectRoot) {
                const pkgPath = path.join(projectRoot, 'package.json');
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    projectMeta = `**${pkg.name || 'Unknown'}** v${pkg.version || '?'}`;
                    if (pkg.description) projectMeta += `\n${pkg.description}`;
                }
            }
        } catch { /* best-effort */ }

        // 2. Tech stack
        const langRows = db.prepare(
            "SELECT language, COUNT(*) as count FROM nodes WHERE symbol_type NOT IN ('file', 'section') GROUP BY language ORDER BY count DESC LIMIT 8"
        ).all() as { language: string; count: number }[];

        // 3. Size metrics
        const totalNodes = (db.prepare("SELECT COUNT(*) as n FROM nodes WHERE symbol_type NOT IN ('file')").get() as { n: number }).n;
        const totalFiles = (db.prepare("SELECT COUNT(*) as n FROM nodes WHERE symbol_type = 'file'").get() as { n: number }).n;
        const totalEdges = (db.prepare("SELECT COUNT(*) as n FROM edges").get() as { n: number }).n;

        // 4. Architecture layers from tags (tags are a JSON-array column on nodes)
        const layerRows = db.prepare(
            "SELECT COUNT(*) as count FROM nodes WHERE tags LIKE '%layer:%'"
        ).get() as { count: number };
        const layerBreakdown = db.prepare(
            "SELECT tags FROM nodes WHERE tags LIKE '%layer:%'"
        ).all() as { tags: string }[];
        const layerCounts = new Map<string, number>();
        for (const row of layerBreakdown) {
            try {
                const tags: string[] = JSON.parse(row.tags);
                for (const t of tags) {
                    if (t.startsWith('layer:')) layerCounts.set(t, (layerCounts.get(t) ?? 0) + 1);
                }
            } catch { /* skip malformed */ }
        }

        // 5. Entry points
        const entryRows = db.prepare(
            "SELECT qualified_name, symbol_type FROM nodes WHERE tags LIKE '%trait:entrypoint%' LIMIT 10"
        ).all() as { qualified_name: string; symbol_type: string }[];

        // 6. Top hotspots (highest fan_in)
        const hotspots = db.prepare(
            "SELECT qualified_name, symbol_type, fan_in FROM nodes WHERE fan_in > 0 AND symbol_type NOT IN ('file','section') ORDER BY fan_in DESC LIMIT 8"
        ).all() as { qualified_name: string; symbol_type: string; fan_in: number }[];

        // 7. Clusters
        let clusterInfo = '';
        if (includeClusters) {
            const clusters = db.prepare(
                "SELECT name, central_symbol_qname, cluster_type FROM logical_clusters ORDER BY name LIMIT 10"
            ).all() as { name: string; central_symbol_qname: string | null; cluster_type: string | null }[];
            if (clusters.length > 0) {
                clusterInfo = '\n## Logical Clusters\n' + clusters.map(c =>
                    `- **${c.name}** (${c.cluster_type ?? 'general'}): core → \`${c.central_symbol_qname ?? 'unknown'}\``
                ).join('\n');
            }
        }

        // 8. Documentation sections from markdown
        const docSections = db.prepare(
            "SELECT signature, docstring FROM nodes WHERE symbol_type = 'section' AND language = 'markdown' AND signature IS NOT NULL ORDER BY qualified_name LIMIT 20"
        ).all() as { signature: string; docstring: string | null }[];

        // Compose the briefing
        const lines: string[] = ['# Project Overview\n'];

        if (projectMeta) lines.push(projectMeta + '\n');

        lines.push(`## Scale\n- ${totalFiles} files · ${totalNodes} symbols · ${totalEdges} relationships`);

        if (langRows.length > 0) {
            lines.push('\n## Tech Stack\n' + langRows.map(r => `- **${r.language}**: ${r.count} symbols`).join('\n'));
        }

        // Prefer the project's declared architecture intent (P6) when present, so the
        // overview reflects the intended design rather than only tag-derived counts.
        const declaredIntent = ctx.archEngine ? ctx.archEngine.getIntent() : null;
        if (declaredIntent && declaredIntent.layers.length > 0) {
            lines.push('\n## Architecture Layers (declared)');
            for (const layer of declaredIntent.layers) {
                const desc = layer.description ? ` — ${layer.description}` : '';
                lines.push(`- **${layer.name}** (\`${layer.pathPattern}\`)${desc}`);
            }
            const respKeys = Object.keys(declaredIntent.responsibilities);
            if (respKeys.length > 0) {
                lines.push('\n## Layer Responsibilities');
                for (const key of respKeys) {
                    lines.push(`- **${key}**: ${declaredIntent.responsibilities[key]}`);
                }
            }
        } else if (layerCounts.size > 0) {
            const sorted = Array.from(layerCounts.entries()).sort((a, b) => b[1] - a[1]);
            lines.push('\n## Architecture Layers\n' + sorted.map(([tag, count]) => `- ${tag} (${count} symbols)`).join('\n'));
        } else if (layerRows.count > 0) {
            lines.push(`\n## Architecture Layers\n- ${layerRows.count} symbols carry layer tags`);
        }

        if (entryRows.length > 0) {
            lines.push('\n## Entry Points\n' + entryRows.map(r => `- \`${r.qualified_name}\` (${r.symbol_type})`).join('\n'));
        }

        if (hotspots.length > 0) {
            lines.push('\n## Most-Referenced Symbols\n' + hotspots.map(r => `- \`${r.qualified_name}\` — ${r.fan_in} callers`).join('\n'));
        }

        if (clusterInfo) lines.push(clusterInfo);

        if (docSections.length > 0) {
            lines.push('\n## Documentation Sections');
            for (const sec of docSections) {
                lines.push(`\n### ${sec.signature}`);
                if (sec.docstring) lines.push(sec.docstring.slice(0, 300));
            }
        }

        return {
            content: [{ type: 'text', text: lines.join('\n') }]
        };
    }
};

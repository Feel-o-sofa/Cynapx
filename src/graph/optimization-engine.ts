/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import { GraphEngine } from './graph-engine';
import { CodeNode, OptimizationReport } from '../types';

/** Files larger than this are not scanned for name references (generated bundles, data dumps). */
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/**
 * Counts identifier occurrences (lowercased, as qnames are) across the given
 * files. Unreadable or oversized files are skipped.
 */
function countIdentifiers(files: Iterable<string>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const file of files) {
        let text: string;
        try {
            if (fs.statSync(file).size > MAX_SCAN_BYTES) continue;
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const token of text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
            const key = token.toLowerCase();
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    return counts;
}

/** The symbol's own name: the last segment of `file#Type.member`. */
const ownName = (node: CodeNode) => (node.qualified_name.split('#').pop() ?? '').split('.').pop() ?? '';

/**
 * OptimizationEngine identifies dead code and opportunities for graph pruning.
 */
export class OptimizationEngine {
    constructor(private graphEngine: GraphEngine) {}

    /**
     * Finds symbols that are likely unused (dead code), classified into three confidence tiers.
     *
     * Common filter (applied to all three queries):
     *   - fan_in = 0
     *   - Exclude files, tests, packages
     *   - Exclude entrypoints and abstract symbols
     *   - Exclude methods whose containing class implements an interface (interface dispatch)
     *   - Exclude methods whose containing class inherits from a parent (polymorphic override)
     *
     * HIGH   : private symbols — likely genuine dead code
     * MEDIUM : public symbols tagged trait:internal — internal but exposed
     * LOW    : public symbols without trait:internal — may be external API surface
     */
    public async findDeadCode(): Promise<OptimizationReport> {
        const nodeRepo = this.graphEngine.nodeRepo;
        const db = nodeRepo.getDb();

        // A-3/A-2: dead-code candidate queries now live in
        // NodeRepository.findDeadCodeCandidates(), using the node_tags JOIN
        // table instead of `tags LIKE '%...%'` on the JSON column.
        const candidates = {
            high: nodeRepo.findDeadCodeCandidates('high'),
            medium: nodeRepo.findDeadCodeCandidates('medium'),
            low: nodeRepo.findDeadCodeCandidates('low'),
        };

        // No call edge is not the same as unused: a function passed as a
        // callback, used as a bare decorator, aliased, or named in a config
        // file is referenced but never called by name. A candidate whose name
        // occurs anywhere besides its own definition is set aside (#21) —
        // the check an agent would otherwise make with grep before trusting it.
        const files = (db.prepare('SELECT DISTINCT file_path FROM nodes').all() as { file_path: string }[]).map(r => r.file_path);
        const occurrences = countIdentifiers(files);
        const definitions = new Map<string, number>();
        for (const row of db.prepare("SELECT qualified_name FROM nodes WHERE qualified_name LIKE '%#%' AND symbol_type NOT IN ('config_key', 'section')").all() as { qualified_name: string }[]) {
            const name = ownName(row as CodeNode);
            definitions.set(name, (definitions.get(name) ?? 0) + 1);
        }
        let referencedByName = 0;
        const unreferenced = (rows: CodeNode[]) => rows.filter(node => {
            const name = ownName(node);
            const referenced = (occurrences.get(name) ?? 0) > (definitions.get(name) ?? 1);
            if (referenced) referencedByName++;
            return !referenced;
        });
        const highRows = unreferenced(candidates.high);
        const mediumRows = unreferenced(candidates.medium);
        const lowRows = unreferenced(candidates.low);

        // Only functions and methods are judged (fan-in counts calls), so the
        // potential is a share of those, not of every indexed symbol (#21).
        const totalSymbols: number = nodeRepo.countDeadCodeAnalyzable();
        const notAnalyzed: number = (db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number }).count - totalSymbols;

        // M-2 v20 (Phase 23-2): guard against division-by-zero on an empty graph
        // (totalSymbols === 0 would yield 0/0 = NaN → "NaN%"). Non-empty behavior is unchanged.
        const deadCount = highRows.length + mediumRows.length + lowRows.length;
        const optimizationPotential = totalSymbols === 0
            ? '0.00%'
            : `${((deadCount / totalSymbols) * 100).toFixed(2)}%`;

        return {
            high: highRows,
            medium: mediumRows,
            low: lowRows,
            potentialDeadCode: highRows,  // 후방 호환 alias
            summary: {
                totalSymbols,
                highConfidenceDead: highRows.length,
                mediumConfidenceDead: mediumRows.length,
                lowConfidenceDead: lowRows.length,
                deadSymbols: deadCount,
                notAnalyzed,
                referencedByName,
                optimizationPotential
            }
        };
    }
}

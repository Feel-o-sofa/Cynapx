/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { GraphEngine } from './graph-engine';
import { CodeNode, OptimizationReport } from '../types';

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
        const highRows: CodeNode[] = nodeRepo.findDeadCodeCandidates('high');
        const mediumRows: CodeNode[] = nodeRepo.findDeadCodeCandidates('medium');
        const lowRows: CodeNode[] = nodeRepo.findDeadCodeCandidates('low');

        const totalSymbols: number = (db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number }).count;

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
                optimizationPotential
            }
        };
    }
}

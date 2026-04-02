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
        const db = (this.graphEngine.nodeRepo as any).db;

        const COMMON_FILTER = `
            WHERE fan_in = 0
            AND symbol_type NOT IN ('file', 'test', 'package')
            AND qualified_name NOT LIKE '%#constructor'
            AND (tags IS NULL OR tags NOT LIKE '%trait:entrypoint%')
            AND (tags IS NULL OR tags NOT LIKE '%trait:abstract%')
            AND NOT EXISTS (
                SELECT 1 FROM edges cont
                JOIN edges impl ON impl.from_id = cont.from_id
                WHERE cont.to_id = nodes.id
                AND cont.edge_type = 'contains'
                AND impl.edge_type = 'implements'
            )
            AND NOT EXISTS (
                SELECT 1 FROM edges cont
                JOIN edges inh ON inh.from_id = cont.from_id
                WHERE cont.to_id = nodes.id
                AND cont.edge_type = 'contains'
                AND inh.edge_type = 'inherits'
            )
        `;

        const highQuery = `SELECT * FROM nodes ${COMMON_FILTER} AND visibility = 'private'`;

        const mediumQuery = `SELECT * FROM nodes ${COMMON_FILTER}
            AND visibility = 'public'
            AND symbol_type NOT IN ('class', 'interface', 'function')
            AND tags LIKE '%trait:internal%'`;

        const lowQuery = `SELECT * FROM nodes ${COMMON_FILTER}
            AND visibility = 'public'
            AND symbol_type NOT IN ('class', 'interface', 'function')
            AND (tags IS NULL OR tags NOT LIKE '%trait:internal%')`;

        const mapRow = (row: any): CodeNode => ({
            ...row,
            tags: row.tags ? JSON.parse(row.tags) : []
        });

        const highRows: CodeNode[] = db.prepare(highQuery).all().map(mapRow);
        const mediumRows: CodeNode[] = db.prepare(mediumQuery).all().map(mapRow);
        const lowRows: CodeNode[] = db.prepare(lowQuery).all().map(mapRow);

        const totalSymbols: number = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;

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
                deadSymbols: highRows.length + mediumRows.length + lowRows.length,
                optimizationPotential: `${(((highRows.length + mediumRows.length + lowRows.length) / totalSymbols) * 100).toFixed(2)}%`
            }
        };
    }
}

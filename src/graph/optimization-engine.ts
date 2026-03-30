/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { GraphEngine } from './graph-engine';
import { CodeNode } from '../types';

export interface OptimizationReport {
    potentialDeadCode: CodeNode[];
    summary: {
        totalSymbols: number;
        deadSymbols: number;
        optimizationPotential: string;
    };
}

/**
 * OptimizationEngine identifies dead code and opportunities for graph pruning.
 */
export class OptimizationEngine {
    constructor(private graphEngine: GraphEngine) {}

    /**
     * Finds symbols that are likely unused (dead code).
     */
    public async findDeadCode(): Promise<OptimizationReport> {
        const db = (this.graphEngine.nodeRepo as any).db;
        
        // Find nodes with no incoming edges (fan_in = 0)
        // Exclude files, tests, entrypoints, and public interfaces.
        //
        // Also exclude methods that belong to a class involved in polymorphism:
        //
        // 1. NOT EXISTS (contains + implements): exclude methods whose containing class
        //    implements an interface. Such methods may be invoked via interface dispatch
        //    (e.g. IFoo.bar()) and will appear unreachable despite being live.
        //    Edge types used:
        //      cont.edge_type = 'contains'   → class contains this method (class→method)
        //      impl.edge_type = 'implements' → that class implements an interface (class→interface)
        //
        // 2. NOT EXISTS (contains + inherits): exclude methods whose containing class
        //    inherits from a parent class. Such methods may override a virtual/abstract
        //    method and be called through the supertype reference.
        //    Edge types used:
        //      cont.edge_type = 'contains'  → class contains this method (class→method)
        //      inh.edge_type  = 'inherits'  → that class inherits from a parent (class→parent)
        const query = `
            SELECT * FROM nodes
            WHERE fan_in = 0
            AND symbol_type NOT IN ('file', 'test', 'package')
            AND (tags IS NULL OR tags NOT LIKE '%trait:entrypoint%')
            AND (tags IS NULL OR tags NOT LIKE '%trait:abstract%')
            AND (visibility != 'public' OR symbol_type NOT IN ('class', 'interface', 'function'))
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

        const rows = db.prepare(query).all();
        const deadCodeNodes = rows.map((row: any) => ({
            ...row,
            tags: row.tags ? JSON.parse(row.tags) : []
        }));

        const totalSymbols = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;

        return {
            potentialDeadCode: deadCodeNodes,
            summary: {
                totalSymbols,
                deadSymbols: deadCodeNodes.length,
                optimizationPotential: `${((deadCodeNodes.length / totalSymbols) * 100).toFixed(2)}%`
            }
        };
    }
}

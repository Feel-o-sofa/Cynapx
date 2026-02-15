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
        const query = `
            SELECT * FROM nodes 
            WHERE fan_in = 0 
            AND symbol_type NOT IN ('file', 'test', 'package')
            AND (tags IS NULL OR tags NOT LIKE '%trait:entrypoint%')
            AND (tags IS NULL OR tags NOT LIKE '%trait:abstract%')
            AND (visibility != 'public' OR symbol_type NOT IN ('class', 'interface', 'function'))
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

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Database } from 'better-sqlite3';

export interface VectorSearchResult {
    id: number;
    distance: number;
}

/**
 * Handles specialized vector search queries using sqlite-vec.
 */
export class VectorRepository {
    constructor(private db: Database) { }

    /**
     * Performs a K-Nearest Neighbor search on the embeddings table.
     */
    public search(embedding: number[], limit: number = 20): VectorSearchResult[] {
        // 0. Safety check: Verify dimension against schema
        try {
            const schema = this.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'node_embeddings'").get() as any;
            if (schema && schema.sql) {
                const match = schema.sql.match(/float\[(\d+)\]/);
                if (match && parseInt(match[1]) !== embedding.length) {
                    console.error(`[VectorRepo] Dimension mismatch: DB expects ${match[1]}, query has ${embedding.length}. Skipping vector search.`);
                    return [];
                }
            }
        } catch (e) {
            return [];
        }

        const buffer = Buffer.from(new Float32Array(embedding).buffer);
        
        const stmt = this.db.prepare(`
            SELECT rowid as id, distance 
            FROM node_embeddings 
            WHERE embedding MATCH ? 
            AND k = ?
        `);

        // Note: ORDER BY is implied by distance in vec0
        const rows = stmt.all(buffer, limit) as VectorSearchResult[];
        return rows;
    }
}

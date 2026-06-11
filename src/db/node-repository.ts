/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Database } from 'better-sqlite3';
import { CodeNode, CodeEdge, SymbolType, Visibility } from '../types';

/** Raw SQLite row from the nodes table (all columns, JSON fields as strings) */
type NodeRow = Record<string, unknown>;

/**
 * Safely parses a JSON string, returning a fallback value on parse failure or empty input.
 */
function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

/**
 * NodeRepository handles CRUD operations for the 'nodes' table.
 */
export class NodeRepository {
    constructor(public db: Database) { }

    public getDb(): Database {
        return this.db;
    }

    public createNode(node: CodeNode): number {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (
        qualified_name, symbol_type, language, file_path, start_line, end_line,
        visibility, is_generated, last_updated_commit, version,
        checksum, modifiers, signature, return_type, field_type,
        loc, cyclomatic, fan_in, fan_out, fan_in_dynamic, fan_out_dynamic,
        cluster_id, remote_project_path, tags, history
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

        const result = stmt.run(
            node.qualified_name,
            node.symbol_type,
            node.language,
            node.file_path,
            node.start_line,
            node.end_line,
            node.visibility,
            node.is_generated ? 1 : 0,
            node.last_updated_commit,
            node.version,
            node.checksum || null,
            node.modifiers ? JSON.stringify(node.modifiers) : null,
            node.signature || null,
            node.return_type || null,
            node.field_type || null,
            node.loc || 0,
            node.cyclomatic || 0,
            node.fan_in || 0,
            node.fan_out || 0,
            node.fan_in_dynamic || 0,
            node.fan_out_dynamic || 0,
            node.cluster_id || null,
            node.remote_project_path || null,
            node.tags ? JSON.stringify(node.tags) : null,
            node.history ? JSON.stringify(node.history) : null
        );

        const nodeId = result.lastInsertRowid as number;

        // A-2: keep node_tags in sync with the nodes.tags JSON column so
        // tag-based queries (e.g. dead-code detection) can JOIN instead of
        // scanning with LIKE. The old node row's tags are removed via the
        // ON DELETE CASCADE FK when INSERT OR REPLACE evicts it.
        if (node.tags && node.tags.length > 0) {
            const insertTag = this.db.prepare('INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)');
            for (const tag of node.tags) {
                insertTag.run(nodeId, tag);
            }
        }

        return nodeId;
    }

    public getNodeById(id: number): CodeNode | null {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
        const row = stmt.get(id) as NodeRow | undefined;
        return row ? this.mapRowToNode(row) : null;
    }

    public getNodeByQualifiedName(qualifiedName: string): CodeNode | null {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE qualified_name = ?');
        const row = stmt.get(qualifiedName) as NodeRow | undefined;
        return row ? this.mapRowToNode(row) : null;
    }

    public getNodeIdsByFilePath(filePath: string): number[] {
        const rows = this.db.prepare(
            'SELECT id FROM nodes WHERE file_path = ?'
        ).all(filePath) as { id: number }[];
        return rows.map(r => r.id);
    }

    public deleteNodesByFilePath(filePath: string): void {
        // O-9: node_embeddings is a vec0 virtual table without FK support, so
        // orphaned embedding rows aren't cleaned up by ON DELETE CASCADE.
        const ids = this.getNodeIdsByFilePath(filePath);
        this.purgeEmbeddings(ids);
        const stmt = this.db.prepare('DELETE FROM nodes WHERE file_path = ?');
        stmt.run(filePath);
    }

    /**
     * Removes node_embeddings rows for the given node ids. node_embeddings
     * is a vec0 virtual table that may not exist in environments where the
     * sqlite-vec extension isn't loaded (e.g. in-memory test databases) —
     * "no such table" is silently ignored in that case.
     */
    public purgeEmbeddings(nodeIds: number[]): void {
        if (nodeIds.length === 0) return;
        try {
            const placeholders = nodeIds.map(() => '?').join(',');
            this.db.prepare(`DELETE FROM node_embeddings WHERE rowid IN (${placeholders})`).run(...nodeIds);
        } catch (err) {
            if (!(err instanceof Error) || !err.message.includes('no such table')) throw err;
        }
    }

    public getNodesByFilePath(filePath: string): CodeNode[] {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE file_path = ?');
        const rows = stmt.all(filePath) as NodeRow[];
        return rows.map(row => this.mapRowToNode(row));
    }

    public getAllFilePaths(): string[] {
        const stmt = this.db.prepare('SELECT DISTINCT file_path FROM nodes');
        const rows = stmt.all() as { file_path: string }[];
        return rows.map(r => r.file_path);
    }

    public getAllNodes(): CodeNode[] {
        const stmt = this.db.prepare('SELECT * FROM nodes');
        const rows = stmt.all() as NodeRow[];
        return rows.map(row => this.mapRowToNode(row));
    }

    public updateCluster(id: number, clusterId: number | null): void {
        const stmt = this.db.prepare('UPDATE nodes SET cluster_id = ? WHERE id = ?');
        stmt.run(clusterId, id);
    }

    public updateMetrics(id: number, metrics: { loc?: number, cyclomatic?: number, fan_in?: number, fan_out?: number, fan_in_dynamic?: number, fan_out_dynamic?: number }): void {
        const sets: string[] = [];
        const values: any[] = [];

        if (metrics.loc !== undefined) { sets.push('loc = ?'); values.push(metrics.loc); }
        if (metrics.cyclomatic !== undefined) { sets.push('cyclomatic = ?'); values.push(metrics.cyclomatic); }
        if (metrics.fan_in !== undefined) { sets.push('fan_in = ?'); values.push(metrics.fan_in); }
        if (metrics.fan_out !== undefined) { sets.push('fan_out = ?'); values.push(metrics.fan_out); }
        if (metrics.fan_in_dynamic !== undefined) { sets.push('fan_in_dynamic = ?'); values.push(metrics.fan_in_dynamic); }
        if (metrics.fan_out_dynamic !== undefined) { sets.push('fan_out_dynamic = ?'); values.push(metrics.fan_out_dynamic); }

        if (sets.length === 0) return;

        values.push(id);
        const stmt = this.db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`);
        stmt.run(...values);
    }

    public searchSymbols(
        query: string, 
        limit: number = 20, 
        filters?: { 
            symbol_type?: SymbolType, 
            language?: string, 
            visibility?: Visibility 
        }
    ): CodeNode[] {
        // Sanitize and prepare FTS query for prefix matching
        // Using "query*" enables prefix search in FTS5
        const sanitizedQuery = query.replace(/[*"']/g, '').trim();
        if (!sanitizedQuery) return [];

        const ftsQuery = `${sanitizedQuery}*`;

        const filterClauses: string[] = [];
        const params: any[] = [ftsQuery];

        if (filters?.symbol_type) {
            filterClauses.push('n.symbol_type = ?');
            params.push(filters.symbol_type);
        }
        if (filters?.language) {
            filterClauses.push('n.language = ?');
            params.push(filters.language);
        }
        if (filters?.visibility) {
            filterClauses.push('n.visibility = ?');
            params.push(filters.visibility);
        }

        const whereClause = filterClauses.length > 0 
            ? `AND ${filterClauses.join(' AND ')}` 
            : '';

        params.push(limit);

        try {
            const stmt = this.db.prepare(`
                SELECT n.* 
                FROM fts_symbols f 
                JOIN nodes n ON f.rowid = n.id 
                WHERE fts_symbols MATCH ? 
                ${whereClause}
                ORDER BY rank 
                LIMIT ?
            `);
            const rows = stmt.all(...params);
            return rows.map(row => this.mapRowToNode(row));
        } catch (error) {
            // Fallback to LIKE if FTS fails or if query is not FTS-friendly
            const likeFilter = filterClauses.length > 0 ? `AND ${filterClauses.join(' AND ')}` : '';
            const stmt = this.db.prepare(`
                SELECT * FROM nodes n 
                WHERE n.qualified_name LIKE ? 
                ${likeFilter}
                ORDER BY length(n.qualified_name) ASC
                LIMIT ?
            `);
            const rows = stmt.all(`%${sanitizedQuery}%`, ...params.slice(1));
            return rows.map(row => this.mapRowToNode(row));
        }
    }

    /**
     * A-3/A-2: Finds dead-code candidates for a given confidence tier.
     * Moved from OptimizationEngine.findDeadCode() and rewritten to use the
     * node_tags JOIN table instead of `tags LIKE '%...%'` on the JSON column.
     *
     * Common filter (applied to all tiers):
     *   - fan_in = 0
     *   - Exclude files, tests, packages, constructors
     *   - Exclude entrypoints and abstract symbols (via node_tags)
     *   - Exclude methods whose containing class implements an interface (interface dispatch)
     *   - Exclude methods whose containing class inherits from a parent (polymorphic override)
     *
     * HIGH   : private symbols — likely genuine dead code
     * MEDIUM : public symbols (non class/interface/function) — internal but exposed
     * LOW    : public symbols (non class/interface/function) without trait:internal — may be external API surface
     */
    public findDeadCodeCandidates(tier: 'high' | 'medium' | 'low'): CodeNode[] {
        const COMMON_FILTER = `
            WHERE n.fan_in = 0
            AND n.symbol_type NOT IN ('file', 'test', 'package')
            AND n.qualified_name NOT LIKE '%#constructor'
            AND NOT EXISTS (SELECT 1 FROM node_tags nt WHERE nt.node_id = n.id AND nt.tag = 'trait:entrypoint')
            AND NOT EXISTS (SELECT 1 FROM node_tags nt WHERE nt.node_id = n.id AND nt.tag = 'trait:abstract')
            AND NOT EXISTS (
                SELECT 1 FROM edges cont
                JOIN edges impl ON impl.from_id = cont.from_id
                WHERE cont.to_id = n.id
                AND cont.edge_type = 'contains'
                AND impl.edge_type = 'implements'
            )
            AND NOT EXISTS (
                SELECT 1 FROM edges cont
                JOIN edges inh ON inh.from_id = cont.from_id
                WHERE cont.to_id = n.id
                AND cont.edge_type = 'contains'
                AND inh.edge_type = 'inherits'
            )
        `;

        let tierFilter: string;
        switch (tier) {
            case 'high':
                tierFilter = `AND n.visibility = 'private'`;
                break;
            case 'medium':
                tierFilter = `AND n.visibility = 'public' AND n.symbol_type NOT IN ('class', 'interface', 'function')`;
                break;
            case 'low':
                tierFilter = `AND n.visibility = 'public'
                    AND n.symbol_type NOT IN ('class', 'interface', 'function')
                    AND NOT EXISTS (SELECT 1 FROM node_tags nt WHERE nt.node_id = n.id AND nt.tag = 'trait:internal')`;
                break;
        }

        const rows = this.db.prepare(`SELECT n.* FROM nodes n ${COMMON_FILTER} ${tierFilter}`).all() as NodeRow[];
        return rows.map(row => this.mapRowToNode(row));
    }

    public findNodesBySymbolName(name: string): CodeNode[] {
        const stmt = this.db.prepare("SELECT * FROM nodes WHERE qualified_name = ? COLLATE NOCASE OR qualified_name LIKE ? COLLATE NOCASE");
        // Match exact name (if global) or suffixed name
        const rows = stmt.all(name, `%#${name}`);
        return rows.map(row => this.mapRowToNode(row));
    }

    public mapRowToNode(row: any): CodeNode {
        return {
            id: row.id,
            qualified_name: row.qualified_name,
            symbol_type: row.symbol_type as SymbolType,
            language: row.language,
            file_path: row.file_path,
            start_line: row.start_line,
            end_line: row.end_line,
            visibility: row.visibility as Visibility,
            is_generated: row.is_generated === 1,
            last_updated_commit: row.last_updated_commit,
            version: row.version,
            checksum: row.checksum,
            modifiers: row.modifiers ? safeJsonParse<string[]>(row.modifiers, []) : undefined,
            signature: row.signature,
            return_type: row.return_type,
            field_type: row.field_type,
            loc: row.loc,
            cyclomatic: row.cyclomatic,
            fan_in: row.fan_in,
            fan_out: row.fan_out,
            fan_in_dynamic: row.fan_in_dynamic,
            fan_out_dynamic: row.fan_out_dynamic,
            cluster_id: row.cluster_id,
            remote_project_path: row.remote_project_path,
            tags: row.tags ? safeJsonParse<string[]>(row.tags, []) : undefined,
            history: row.history ? safeJsonParse<{ hash: string; message: string; author: string; date: string }[]>(row.history, []) : undefined
        };
    }
}

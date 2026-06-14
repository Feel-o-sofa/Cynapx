/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Database, Statement } from 'better-sqlite3';
import { CodeNode, CodeEdge, SymbolType, Visibility } from '../types';

/** Raw SQLite row from the nodes table (all columns, JSON fields as strings) */
type NodeRow = Record<string, unknown>;

/**
 * A-4: extracts the bare symbol name from a qualified_name. qualified_name uses
 * a single '#' separator (`${file}#${parts}`), so the bare name is everything
 * after the first '#'. Names with no '#' (e.g. `package:foo`, file nodes) are
 * returned unchanged. This mirrors the SQL backfill in migration 2 → 3.
 */
export function extractSymbolName(qualifiedName: string): string {
    const idx = qualifiedName.indexOf('#');
    return idx === -1 ? qualifiedName : qualifiedName.slice(idx + 1);
}

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
    // A-5: cached prepared statements for hot paths. better-sqlite3 re-uses a
    // compiled statement across calls, so caching avoids re-parsing SQL on every
    // createNode()/replaceTags()/etc. Mirrors EdgeRepository's pattern.
    private _upsertStmt?: Statement;
    private _deleteTagsStmt?: Statement;
    private _insertTagStmt?: Statement;
    private _updateTagsStmt?: Statement;
    private _bySymbolNameStmt?: Statement;
    private _updateClusterStmt?: Statement;

    constructor(public db: Database) { }

    public getDb(): Database {
        return this.db;
    }

    /**
     * A-5/A-11: drops all cached prepared statements so they get re-prepared
     * against the current schema. Call after running migrations on a database
     * whose NodeRepository was constructed beforehand (the symbol_name column
     * added by migration 2 → 3 changes the createNode() statement shape).
     */
    public invalidateStatementCache(): void {
        this._upsertStmt = undefined;
        this._deleteTagsStmt = undefined;
        this._insertTagStmt = undefined;
        this._updateTagsStmt = undefined;
        this._bySymbolNameStmt = undefined;
        this._updateClusterStmt = undefined;
    }

    public createNode(node: CodeNode): number {
        // A-1: explicit UPSERT on qualified_name instead of INSERT OR REPLACE.
        // INSERT OR REPLACE deletes the conflicting row and inserts a new one,
        // which (a) allocates a fresh id — silently breaking every edge in
        // other files that referenced the old id via the FK ON DELETE CASCADE,
        // and (b) fires nodes_ad/nodes_ai instead of nodes_au. ON CONFLICT DO
        // UPDATE keeps the existing id and fires nodes_au (which keeps
        // fts_symbols in sync), so cross-file edges and the FTS index survive a
        // re-index of the same symbol. RETURNING id works for both the INSERT
        // and the UPDATE branch (lastInsertRowid is not set on a pure UPDATE).
        // A-5: cache the upsert statement across calls.
        if (!this._upsertStmt) {
            this._upsertStmt = this.db.prepare(`
      INSERT INTO nodes (
        qualified_name, symbol_name, symbol_type, language, file_path, start_line, end_line,
        visibility, is_generated, last_updated_commit, version,
        checksum, modifiers, signature, return_type, field_type,
        loc, cyclomatic, fan_in, fan_out, fan_in_dynamic, fan_out_dynamic,
        cluster_id, remote_project_path, tags, history
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
      ON CONFLICT(qualified_name) DO UPDATE SET
        symbol_name = excluded.symbol_name,
        symbol_type = excluded.symbol_type,
        language = excluded.language,
        file_path = excluded.file_path,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        visibility = excluded.visibility,
        is_generated = excluded.is_generated,
        last_updated_commit = excluded.last_updated_commit,
        version = excluded.version,
        checksum = excluded.checksum,
        modifiers = excluded.modifiers,
        signature = excluded.signature,
        return_type = excluded.return_type,
        field_type = excluded.field_type,
        loc = excluded.loc,
        cyclomatic = excluded.cyclomatic,
        fan_in = excluded.fan_in,
        fan_out = excluded.fan_out,
        fan_in_dynamic = excluded.fan_in_dynamic,
        fan_out_dynamic = excluded.fan_out_dynamic,
        cluster_id = excluded.cluster_id,
        remote_project_path = excluded.remote_project_path,
        tags = excluded.tags,
        history = excluded.history
      RETURNING id
    `);
        }
        const stmt = this._upsertStmt;

        const row = stmt.get(
            node.qualified_name,
            extractSymbolName(node.qualified_name),
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
        ) as { id: number };

        const nodeId = row.id;

        // A-2/A-1: keep node_tags in sync with the nodes.tags JSON column. On a
        // DO UPDATE branch the node id is preserved, so stale tags from a prior
        // index of this symbol would otherwise remain — clear them first, then
        // re-insert the current tag set.
        if (!this._deleteTagsStmt) this._deleteTagsStmt = this.db.prepare('DELETE FROM node_tags WHERE node_id = ?');
        this._deleteTagsStmt.run(nodeId);
        if (node.tags && node.tags.length > 0) {
            if (!this._insertTagStmt) this._insertTagStmt = this.db.prepare('INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)');
            for (const tag of node.tags) {
                this._insertTagStmt.run(nodeId, tag);
            }
        }

        return nodeId;
    }

    /**
     * M2: Replaces a node's tags, keeping the node_tags mirror table in sync
     * with the nodes.tags JSON column (invariant established by migration 2).
     * Callers performing bulk updates should wrap calls in a transaction.
     */
    public replaceTags(nodeId: number, tags: string[]): void {
        if (!this._updateTagsStmt) this._updateTagsStmt = this.db.prepare('UPDATE nodes SET tags = ? WHERE id = ?');
        this._updateTagsStmt.run(JSON.stringify(tags), nodeId);
        if (!this._deleteTagsStmt) this._deleteTagsStmt = this.db.prepare('DELETE FROM node_tags WHERE node_id = ?');
        this._deleteTagsStmt.run(nodeId);
        if (tags.length > 0) {
            if (!this._insertTagStmt) this._insertTagStmt = this.db.prepare('INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)');
            for (const tag of tags) {
                this._insertTagStmt.run(nodeId, tag);
            }
        }
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

    /**
     * Returns the total node count via a single COUNT(*) probe, without
     * materializing the node array. Used by the count-first clustering guard
     * (M-4, Phase 15-1) to short-circuit before getAllNodes() loads the full set.
     */
    public countNodes(): number {
        const row = this.db.prepare('SELECT COUNT(*) AS n FROM nodes').get() as { n: number };
        return row.n;
    }

    public updateCluster(id: number, clusterId: number | null): void {
        // A-5: cached — persistClusters() calls this once per clustered node.
        if (!this._updateClusterStmt) this._updateClusterStmt = this.db.prepare('UPDATE nodes SET cluster_id = ? WHERE id = ?');
        this._updateClusterStmt.run(clusterId, id);
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
        // A-4: probe the indexed symbol_name column (the bare name after '#'),
        // replacing the unindexable `qualified_name LIKE '%#name'` full scan.
        // createNode() sets symbol_name = extractSymbolName(qualified_name), so a
        // GLOBAL symbol (no '#') has symbol_name == qualified_name — a single
        // equality probe on symbol_name therefore covers both suffixed and
        // global forms, and an OR on qualified_name would be redundant.
        //
        // idx_nodes_symbol_name is declared COLLATE NOCASE so this
        // case-insensitive equality resolves to an indexed SEARCH rather than a
        // full SCAN. A `... COLLATE NOCASE` query against a BINARY index cannot
        // use the index, so the index collation MUST match the query collation.
        if (!this._bySymbolNameStmt) {
            this._bySymbolNameStmt = this.db.prepare(
                'SELECT * FROM nodes WHERE symbol_name = ? COLLATE NOCASE'
            );
        }
        const rows = this._bySymbolNameStmt.all(name);
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

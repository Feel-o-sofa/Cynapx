/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Database, Statement } from 'better-sqlite3';
import { CodeEdge, EdgeType } from '../types';

/**
 * EdgeRepository handles CRUD operations for the 'edges' table.
 */
export class EdgeRepository {
    // Cached prepared statements
    private _insertStmt?: Statement;
    private _allStmt?: Statement;
    private _outAllStmt?: Statement;
    private _outTypedStmt?: Statement;
    private _inAllStmt?: Statement;
    private _inTypedStmt?: Statement;
    private _deleteStmt?: Statement;

    constructor(private db: Database) { }

    public createEdge(edge: CodeEdge): void {
        if (!this._insertStmt) {
            this._insertStmt = this.db.prepare(
                'INSERT INTO edges (from_id, to_id, edge_type, dynamic, call_site_line) VALUES (?, ?, ?, ?, ?)'
            );
        }
        this._insertStmt.run(edge.from_id, edge.to_id, edge.edge_type, edge.dynamic ? 1 : 0, edge.call_site_line || null);
    }

    public getAllEdges(): CodeEdge[] {
        if (!this._allStmt) {
            this._allStmt = this.db.prepare('SELECT * FROM edges');
        }
        return (this._allStmt.all() as any[]).map(row => this.mapRowToEdge(row));
    }

    public getOutgoingEdges(nodeId: number, edgeType?: EdgeType): CodeEdge[] {
        if (edgeType) {
            if (!this._outTypedStmt) {
                this._outTypedStmt = this.db.prepare('SELECT * FROM edges WHERE from_id = ? AND edge_type = ?');
            }
            return (this._outTypedStmt.all(nodeId, edgeType) as any[]).map(row => this.mapRowToEdge(row));
        }
        if (!this._outAllStmt) {
            this._outAllStmt = this.db.prepare('SELECT * FROM edges WHERE from_id = ?');
        }
        return (this._outAllStmt.all(nodeId) as any[]).map(row => this.mapRowToEdge(row));
    }

    public getIncomingEdges(nodeId: number, edgeType?: EdgeType): CodeEdge[] {
        if (edgeType) {
            if (!this._inTypedStmt) {
                this._inTypedStmt = this.db.prepare('SELECT * FROM edges WHERE to_id = ? AND edge_type = ?');
            }
            return (this._inTypedStmt.all(nodeId, edgeType) as any[]).map(row => this.mapRowToEdge(row));
        }
        if (!this._inAllStmt) {
            this._inAllStmt = this.db.prepare('SELECT * FROM edges WHERE to_id = ?');
        }
        return (this._inAllStmt.all(nodeId) as any[]).map(row => this.mapRowToEdge(row));
    }

    public deleteEdgesByNodeId(nodeId: number): void {
        if (!this._deleteStmt) {
            this._deleteStmt = this.db.prepare('DELETE FROM edges WHERE from_id = ? OR to_id = ?');
        }
        this._deleteStmt.run(nodeId, nodeId);
    }

    private mapRowToEdge(row: any): CodeEdge {
        return {
            from_id: row.from_id,
            to_id: row.to_id,
            edge_type: row.edge_type as EdgeType,
            dynamic: row.dynamic === 1,
            call_site_line: row.call_site_line
        };
    }
}

import { Database } from 'better-sqlite3';
import { CodeEdge, EdgeType } from '../types';

/**
 * EdgeRepository handles CRUD operations for the 'edges' table.
 */
export class EdgeRepository {
    constructor(private db: Database) { }

    public createEdge(edge: CodeEdge): void {
        const stmt = this.db.prepare(`
      INSERT INTO edges (from_id, to_id, edge_type, dynamic, call_site_line)
      VALUES (?, ?, ?, ?, ?)
    `);

        stmt.run(
            edge.from_id,
            edge.to_id,
            edge.edge_type,
            edge.dynamic ? 1 : 0,
            edge.call_site_line || null
        );
    }

    public getOutgoingEdges(nodeId: number, edgeType?: EdgeType): CodeEdge[] {
        let query = 'SELECT * FROM edges WHERE from_id = ?';
        const params: any[] = [nodeId];

        if (edgeType) {
            query += ' AND edge_type = ?';
            params.push(edgeType);
        }

        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params) as any[];
        return rows.map(row => this.mapRowToEdge(row));
    }

    public getIncomingEdges(nodeId: number, edgeType?: EdgeType): CodeEdge[] {
        let query = 'SELECT * FROM edges WHERE to_id = ?';
        const params: any[] = [nodeId];

        if (edgeType) {
            query += ' AND edge_type = ?';
            params.push(edgeType);
        }

        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params) as any[];
        return rows.map(row => this.mapRowToEdge(row));
    }

    public deleteEdgesByNodeId(nodeId: number): void {
        const stmt = this.db.prepare('DELETE FROM edges WHERE from_id = ? OR to_id = ?');
        stmt.run(nodeId, nodeId);
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

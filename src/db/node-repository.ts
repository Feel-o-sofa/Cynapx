import { Database } from 'better-sqlite3';
import { CodeNode, CodeEdge, SymbolType, Visibility } from '../types';

/**
 * NodeRepository handles CRUD operations for the 'nodes' table.
 */
export class NodeRepository {
    constructor(private db: Database) { }

    public createNode(node: CodeNode): number {
        const stmt = this.db.prepare(`
      INSERT INTO nodes (
        qualified_name, symbol_type, language, file_path, start_line, end_line,
        visibility, is_generated, last_updated_commit, version,
        checksum, modifiers, signature, return_type, field_type,
        loc, cyclomatic, fan_in, fan_out
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
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
            node.fan_out || 0
        );

        return result.lastInsertRowid as number;
    }

    public getNodeById(id: number): CodeNode | null {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
        const row = stmt.get(id) as any;
        return row ? this.mapRowToNode(row) : null;
    }

    public getNodeByQualifiedName(qualifiedName: string): CodeNode | null {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE qualified_name = ?');
        const row = stmt.get(qualifiedName) as any;
        return row ? this.mapRowToNode(row) : null;
    }

    public deleteNodesByFilePath(filePath: string): void {
        const stmt = this.db.prepare('DELETE FROM nodes WHERE file_path = ?');
        stmt.run(filePath);
    }

    public getNodesByFilePath(filePath: string): CodeNode[] {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE file_path = ?');
        const rows = stmt.all(filePath) as any[];
        return rows.map(row => this.mapRowToNode(row));
    }

    public updateMetrics(id: number, metrics: { loc?: number, cyclomatic?: number, fan_in?: number, fan_out?: number }): void {
        const sets: string[] = [];
        const values: any[] = [];

        if (metrics.loc !== undefined) { sets.push('loc = ?'); values.push(metrics.loc); }
        if (metrics.cyclomatic !== undefined) { sets.push('cyclomatic = ?'); values.push(metrics.cyclomatic); }
        if (metrics.fan_in !== undefined) { sets.push('fan_in = ?'); values.push(metrics.fan_in); }
        if (metrics.fan_out !== undefined) { sets.push('fan_out = ?'); values.push(metrics.fan_out); }

        if (sets.length === 0) return;

        values.push(id);
        const stmt = this.db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`);
        stmt.run(...values);
    }

    public searchSymbols(query: string, limit: number = 20): CodeNode[] {
        const stmt = this.db.prepare('SELECT * FROM nodes WHERE qualified_name LIKE ? LIMIT ?');
        const rows = stmt.all(`%${query}%`, limit);
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
            modifiers: row.modifiers ? JSON.parse(row.modifiers) : undefined,
            signature: row.signature,
            return_type: row.return_type,
            field_type: row.field_type,
            loc: row.loc,
            cyclomatic: row.cyclomatic,
            fan_in: row.fan_in,
            fan_out: row.fan_out
        };
    }
}

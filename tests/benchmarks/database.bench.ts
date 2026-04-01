/**
 * Benchmark: SQLite operations using better-sqlite3 directly.
 *
 * Uses an in-memory database with the project schema to measure:
 *  - Bulk insert of 100 nodes in a single transaction
 *  - Point-lookup query by qualified_name
 */
import { bench, describe, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const SCHEMA_PATH = path.resolve(__dirname, '../../schema/schema.sql');

let db: Database.Database;

/** Build a minimal synthetic node fixture. */
function makeNode(i: number) {
    return {
        qualified_name: `bench/Module#node_${i}`,
        symbol_type: 'function',
        language: 'typescript',
        file_path: `/bench/module_${i % 10}.ts`,
        start_line: (i * 10) + 1,
        end_line: (i * 10) + 8,
        visibility: 'public',
        is_generated: 0,
        last_updated_commit: 'abc1234',
        version: 1,
    };
}

const INSERT_SQL = `
    INSERT OR REPLACE INTO nodes (
        qualified_name, symbol_type, language, file_path,
        start_line, end_line, visibility, is_generated,
        last_updated_commit, version
    ) VALUES (
        @qualified_name, @symbol_type, @language, @file_path,
        @start_line, @end_line, @visibility, @is_generated,
        @last_updated_commit, @version
    )
`;

const NODES_100 = Array.from({ length: 100 }, (_, i) => makeNode(i));

beforeAll(() => {
    db = new Database(':memory:');
    sqliteVec.load(db);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');

    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);

    // Pre-populate a few rows so the query bench has something to find
    const stmt = db.prepare(INSERT_SQL);
    const insert = db.transaction((rows: ReturnType<typeof makeNode>[]) => {
        for (const row of rows) stmt.run(row);
    });
    insert(NODES_100.slice(0, 10));
});

afterAll(() => {
    db.close();
});

describe('SQLite — node operations', () => {
    bench('insert 100 nodes in a transaction', () => {
        // Use unique names per iteration to avoid UNIQUE conflicts
        const ts = Date.now();
        const rows = Array.from({ length: 100 }, (_, i) => ({
            ...makeNode(i),
            qualified_name: `bench/iter_${ts}#node_${i}`,
        }));
        const stmt = db.prepare(INSERT_SQL);
        const insert = db.transaction((r: typeof rows) => {
            for (const row of r) stmt.run(row);
        });
        insert(rows);
    });

    bench('query node by qualified_name (prepared statement)', () => {
        const stmt = db.prepare('SELECT * FROM nodes WHERE qualified_name = ?');
        stmt.get('bench/Module#node_5');
    });
});

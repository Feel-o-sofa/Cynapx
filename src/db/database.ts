import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { Disposable } from '../types';

/**
 * DatabaseManager handles SQLite connection and schema initialization.
 */
export class DatabaseManager implements Disposable {
    private db: Database.Database;

    constructor(dbPath: string) {
        // Ensure the database file's directory exists
        const dirname = path.dirname(dbPath);
        if (!fs.existsSync(dirname)) {
            fs.mkdirSync(dirname, { recursive: true });
        }

        this.db = new Database(dbPath);
        // Advanced Performance Tuning for Large Knowledge Graphs
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('cache_size = -2000000'); // ~2GB Cache
        this.db.pragma('mmap_size = 30000000000'); // Up to 30GB Memory-mapped I/O
        this.db.pragma('temp_store = MEMORY');
        this.db.pragma('page_size = 4096');

        this.initializeSchema();
    }

    /**
     * Reads and executes the schema.sql file to set up the database.
     */
    private initializeSchema(): void {
        // schema.sql is always located relative to this source file in the project
        const schemaPath = path.resolve(__dirname, '../../schema/schema.sql');
        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Schema file not found at ${schemaPath}`);
        }

        const schema = fs.readFileSync(schemaPath, 'utf8');
        this.db.exec(schema);
    }

    /**
     * Returns the database connection.
     */
    public getDb(): Database.Database {
        return this.db;
    }

    /**
     * Closes the database connection.
     */
    public dispose(): void {
        this.db.close();
    }
}

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as sqliteVec from 'sqlite-vec';

import { Disposable } from '../types';

/**
 * DatabaseManager handles SQLite connection and schema initialization.
 */
export class DatabaseManager implements Disposable {
    private db: Database.Database;
    private _closed: boolean = false;
    // M3/A-11: callbacks fired after runMigrations() actually applied one or
    // more migrations (e.g. to invalidate prepared-statement caches that were
    // built against the pre-migration schema).
    private migrationCallbacks: Array<() => void> = [];

    constructor(dbPath: string) {
        // Ensure the database file's directory exists
        const dirname = path.dirname(dbPath);
        if (!fs.existsSync(dirname)) {
            fs.mkdirSync(dirname, { recursive: true });
        }

        this.db = new Database(dbPath);

        // Load sqlite-vec extension
        sqliteVec.load(this.db);

        // Advanced Performance Tuning for Large Knowledge Graphs
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('synchronous = NORMAL');
        // Dynamic cache/mmap sizing based on DB file size
        const dbSizeMB = fs.existsSync(dbPath) ? fs.statSync(dbPath).size / (1024 * 1024) : 0;
        const cacheSizeKB = Math.min(Math.max(Math.ceil(dbSizeMB * 2), 64), 512) * 1024; // 64MB ~ 512MB
        const mmapSize = Math.min(Math.max(Math.ceil(dbSizeMB * 4), 64), 2048) * 1024 * 1024; // 64MB ~ 2GB
        this.db.pragma(`cache_size = -${cacheSizeKB}`); // negative = KB
        this.db.pragma(`mmap_size = ${mmapSize}`);
        this.db.pragma('temp_store = MEMORY');
        this.db.pragma('page_size = 4096');

        this.initializeSchema();
        this.runMigrations();
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
     * Current schema version. Increment this when adding new migrations.
     */
    public static readonly SCHEMA_VERSION = 2;

    /**
     * M3/A-11: Registers a callback invoked at the end of runMigrations()
     * whenever at least one migration was applied. Use this to invalidate
     * caches (e.g. EdgeRepository's prepared statements) that may reference
     * the pre-migration schema. Not invoked when already at the latest version.
     */
    public onMigration(cb: () => void): void {
        this.migrationCallbacks.push(cb);
    }

    /**
     * Runs pending schema migrations using PRAGMA user_version as the version counter.
     * Each migration is idempotent (INSERT OR IGNORE / safe DDL).
     */
    public runMigrations(): void {
        const current = (this.db.pragma('user_version', { simple: true }) as number) ?? 0;
        if (current >= DatabaseManager.SCHEMA_VERSION) return;

        const migrate = this.db.transaction(() => {
            if (current < 1) {
                // Migration 0 → 1: seed cynapx_version and indexed_at keys in index_metadata
                this.db.prepare(
                    "INSERT OR IGNORE INTO index_metadata (key, value) VALUES ('cynapx_version', '')"
                ).run();
                this.db.prepare(
                    "INSERT OR IGNORE INTO index_metadata (key, value) VALUES ('indexed_at', '')"
                ).run();
                this.db.pragma(`user_version = 1`);
            }

            if (current < 2) {
                // Migration 1 → 2 (A-2): normalize nodes.tags (JSON array) into a
                // node_tags(node_id, tag) table so dead-code/tag filters can JOIN
                // instead of using LIKE on the JSON blob.
                this.db.exec(`
                    CREATE TABLE IF NOT EXISTS node_tags (
                        node_id INTEGER NOT NULL,
                        tag TEXT NOT NULL,
                        PRIMARY KEY (node_id, tag),
                        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_node_tags_tag ON node_tags (tag);
                `);

                const rows = this.db.prepare(
                    "SELECT id, tags FROM nodes WHERE tags IS NOT NULL AND tags != ''"
                ).all() as { id: number; tags: string }[];
                const insertTag = this.db.prepare('INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)');
                for (const row of rows) {
                    try {
                        const tags = JSON.parse(row.tags) as string[];
                        for (const tag of tags) insertTag.run(row.id, tag);
                    } catch {
                        // Skip rows with malformed tags JSON.
                    }
                }

                this.db.pragma(`user_version = 2`);
            }
        });
        migrate();

        // M3/A-11: a migration ran — notify registered listeners so stale
        // prepared-statement caches can be invalidated.
        for (const cb of this.migrationCallbacks) {
            try { cb(); } catch { /* listeners must not break migrations */ }
        }
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
        if (this._closed) return;
        this._closed = true;
        this.db.close();
    }
}

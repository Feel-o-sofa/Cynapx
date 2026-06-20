/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import SQLiteDatabase from 'better-sqlite3';
import * as fs from 'fs';
import { NodeRepository } from '../db/node-repository';
import { extractSymbolName } from '../db/node-repository';
import { DatabaseManager } from '../db/database';
import { readRegistry, toCanonical } from '../utils/paths';
import { CodeNode, SymbolType, Visibility } from '../types';
import { Logger } from '../utils/logger';

const log = new Logger('CrossProjectResolver');

/**
 * A-3(2): the lowest schema version we will run queries against. A remote DB
 * reporting `user_version` of 0 with no recognizable `nodes` table (or a value
 * far outside the range Cynapx has ever produced) is treated as untrusted —
 * a crafted file registered as a "remote project" — and skipped rather than
 * queried. The upper bound is generous so a remote project indexed by a
 * *newer* Cynapx (whose schema we still understand for the columns we read)
 * is not rejected; we only guard against absurd/garbage values.
 */
const MAX_TRUSTED_SCHEMA_VERSION = DatabaseManager.SCHEMA_VERSION + 100;

/**
 * A-3(1): schema version at which the `symbol_name` column + its index exist
 * (migration 2 → 3). At or above this we use an indexed equality probe; below
 * it we fall back to the unindexable leading-wildcard LIKE.
 */
const SYMBOL_NAME_SCHEMA_VERSION = 3;

/** Raw SQLite row from a remote project's nodes table */
interface RemoteNodeRow {
    qualified_name: string;
    symbol_type: SymbolType;
    language: string;
    file_path: string;
    start_line: number;
    end_line: number;
    visibility: Visibility;
    signature?: string;
    return_type?: string;
    tags?: string;
    history?: string;
}

/**
 * CrossProjectResolver handles resolution of symbols that live in other
 * registered Cynapx projects (Boundaryless Edge Discovery — Task 31).
 *
 * Responsibilities:
 *  - Read the global project registry
 *  - Open remote SQLite DBs (read-only, with try-finally for cleanup)
 *  - Create Shadow Nodes in the local DB for matched remote symbols
 */
export class CrossProjectResolver {
    // O-3: when a batch is open, remote DB connections are kept alive and
    // reused across resolve() calls instead of being opened/closed per symbol.
    private batchDbCache: Map<string, SQLiteDatabase.Database> | null = null;

    // A-3(1): per-DB cache of "does this remote schema have the indexed
    // symbol_name column?" so we probe PRAGMA at most once per connection.
    private symbolNameCapable: Map<SQLiteDatabase.Database, boolean> = new Map();

    // A-3(1): remote DB paths for which we have already warned about the
    // un-indexed LIKE fallback (old schema) — keeps the warning one-time, not
    // per-query.
    private warnedLegacySchema: Set<string> = new Set();

    constructor(
        private nodeRepo: NodeRepository,
        private localProjectPath: string
    ) {}

    /**
     * Starts a batch: subsequent resolve() calls reuse cached remote DB
     * connections until endBatch() is called.
     */
    public beginBatch(): void {
        this.batchDbCache = new Map();
    }

    /**
     * Ends the current batch, closing any remote DB connections opened
     * during it.
     */
    public endBatch(): void {
        if (!this.batchDbCache) return;
        for (const db of this.batchDbCache.values()) {
            try { db.close(); } catch { /* ignore */ }
            this.symbolNameCapable.delete(db);
        }
        this.batchDbCache = null;
    }

    private openRemoteDb(dbPath: string): SQLiteDatabase.Database | undefined {
        if (this.batchDbCache) {
            const cached = this.batchDbCache.get(dbPath);
            if (cached) return cached;
            if (!fs.existsSync(dbPath)) return undefined;
            const db = new SQLiteDatabase(dbPath, { readonly: true });
            if (!this.isTrustedRemoteDb(db, dbPath)) {
                try { db.close(); } catch { /* ignore */ }
                return undefined;
            }
            this.batchDbCache.set(dbPath, db);
            return db;
        }
        if (!fs.existsSync(dbPath)) return undefined;
        const db = new SQLiteDatabase(dbPath, { readonly: true });
        if (!this.isTrustedRemoteDb(db, dbPath)) {
            try { db.close(); } catch { /* ignore */ }
            return undefined;
        }
        return db;
    }

    /**
     * A-3(2): trust/sanity check run immediately after opening a remote DB.
     * Guards against a crafted/garbage file registered as a "remote project":
     *  - `user_version` must be a sane integer within the expected range
     *    (>= 1, i.e. a Cynapx-migrated DB, and not absurdly far in the future).
     *  - the `nodes` table must exist with the columns we read.
     * Returns false (and logs a warning) when the DB should be skipped.
     */
    private isTrustedRemoteDb(db: SQLiteDatabase.Database, dbPath: string): boolean {
        try {
            const userVersion = db.pragma('user_version', { simple: true }) as number;
            // An out-of-range / non-integer user_version is a strong signal of a
            // crafted or unrelated file — reject outright. (A version of 0 is
            // allowed only if the nodes table below checks out, to support
            // legitimate pre-migration legacy remote DBs via the LIKE fallback.)
            if (typeof userVersion !== 'number' || !Number.isInteger(userVersion)
                || userVersion < 0 || userVersion > MAX_TRUSTED_SCHEMA_VERSION) {
                log.warn('Skipping remote DB: unexpected schema version', {
                    dbPath,
                    userVersion,
                    expectedMax: MAX_TRUSTED_SCHEMA_VERSION
                });
                return false;
            }

            // Confirm the `nodes` table exists with the columns we read. A
            // missing/garbage nodes table (e.g. a crafted DB with user_version
            // spoofed to 0) is skipped.
            const cols = db.prepare('PRAGMA table_info(nodes)').all() as { name: string }[];
            if (cols.length === 0 || !cols.some(c => c.name === 'qualified_name')) {
                log.warn('Skipping remote DB: missing nodes table or qualified_name column', { dbPath });
                return false;
            }

            // A-3(1): record symbol_name capability (column present AND schema
            // version high enough that the column is populated/indexed).
            const hasSymbolName = userVersion >= SYMBOL_NAME_SCHEMA_VERSION
                && cols.some(c => c.name === 'symbol_name');
            this.symbolNameCapable.set(db, hasSymbolName);
            return true;
        } catch (err) {
            log.warn('Skipping remote DB: sanity check failed', {
                dbPath,
                error: err instanceof Error ? err.message : String(err)
            });
            return false;
        }
    }

    /**
     * Attempts to resolve a qualified name by searching all other registered projects.
     * If a match is found, a Shadow Node is created in the local DB.
     * @returns the local shadow node ID, or undefined if not found
     */
    public resolve(qname: string, canonicalQName: string): number | undefined {
        const registry = readRegistry();
        const otherProjects = registry.filter(
            p => toCanonical(p.path) !== toCanonical(this.localProjectPath)
        );

        // Extract pure symbol name if qualified (e.g. "path/to/file.ts#MyClass" -> "MyClass")
        const symbolName = qname.includes('#') ? qname.split('#').pop()! : qname;

        for (const project of otherProjects) {
            try {
                const remoteDb = this.openRemoteDb(project.db_path);
                if (!remoteDb) continue;

                try {
                    let remoteMatch: RemoteNodeRow | undefined;
                    if (this.symbolNameCapable.get(remoteDb)) {
                        // A-3(1): remote schema has the indexed symbol_name column
                        // (migration 2 → 3). Probe it with a single equality predicate
                        // so SQLite resolves to an indexed SEARCH via
                        // idx_nodes_symbol_name, instead of a leading-wildcard
                        // `LIKE '%#name'` full table SCAN. This mirrors the local
                        // findNodesBySymbolName() probe.
                        //
                        // createNode() sets symbol_name = extractSymbolName(qualified_name),
                        // so a global symbol (no '#') has symbol_name == qualified_name;
                        // the bare name therefore matches both suffixed and global forms
                        // in one indexed lookup. We DON'T OR in
                        // `qualified_name = ? COLLATE NOCASE`: a NOCASE predicate can't
                        // use the BINARY qualified_name index, and ORing an
                        // unindexable branch defeats the optimizer's OR-by-union and
                        // forces a full scan. Instead, among the (usually one) indexed
                        // candidates we prefer an exact canonical match in JS.
                        const remoteStmt = remoteDb.prepare(
                            'SELECT * FROM nodes WHERE symbol_name = ? COLLATE NOCASE'
                        );
                        const candidates = remoteStmt.all(extractSymbolName(symbolName)) as RemoteNodeRow[];
                        remoteMatch =
                            candidates.find(c => toCanonical(c.qualified_name).toLowerCase() === canonicalQName.toLowerCase())
                            ?? candidates[0];
                    } else {
                        // A-3(1) fallback: older remote schema (< v3) has no
                        // symbol_name column, so the only reverse-name option is the
                        // unindexable leading-wildcard LIKE. Warn ONCE per remote DB
                        // (not per query) that the remote project should be re-indexed.
                        if (!this.warnedLegacySchema.has(project.db_path)) {
                            this.warnedLegacySchema.add(project.db_path);
                            log.warn(
                                'Remote project uses a legacy schema without the symbol_name index; ' +
                                'falling back to an un-indexed full-scan lookup. Re-index this project to speed up cross-project resolution.',
                                { project: project.name, dbPath: project.db_path }
                            );
                        }
                        const remoteStmt = remoteDb.prepare(
                            'SELECT * FROM nodes WHERE qualified_name = ? COLLATE NOCASE OR qualified_name LIKE ? COLLATE NOCASE LIMIT 1'
                        );
                        remoteMatch = remoteStmt.get(canonicalQName, `%#${symbolName}`) as RemoteNodeRow | undefined;
                    }

                    if (remoteMatch) {
                        const shadowNodeId = this.nodeRepo.createNode({
                            qualified_name: `remote:${project.name}:${remoteMatch.qualified_name}`,
                            symbol_type: remoteMatch.symbol_type,
                            language: remoteMatch.language,
                            file_path: remoteMatch.file_path,
                            start_line: remoteMatch.start_line,
                            end_line: remoteMatch.end_line,
                            visibility: remoteMatch.visibility,
                            is_generated: true,
                            last_updated_commit: 'remote',
                            version: 0,
                            remote_project_path: project.path,
                            signature: remoteMatch.signature,
                            return_type: remoteMatch.return_type,
                            tags: remoteMatch.tags ? JSON.parse(remoteMatch.tags) : undefined,
                            history: remoteMatch.history ? JSON.parse(remoteMatch.history) : undefined
                        });
                        return shadowNodeId;
                    }
                } finally {
                    if (!this.batchDbCache) {
                        remoteDb.close();
                        this.symbolNameCapable.delete(remoteDb);
                    }
                }
            } catch {
                // Silently ignore errors for specific remote DBs.
                // M1: unconditionally close AND evict the cached connection for
                // this path — leaving it open leaks a file handle, and leaving
                // a broken connection cached makes every later resolve() in
                // the batch fail for this project.
                const broken = this.batchDbCache?.get(project.db_path);
                if (broken) {
                    try { broken.close(); } catch { /* ignore */ }
                    this.batchDbCache?.delete(project.db_path);
                    this.symbolNameCapable.delete(broken);
                }
            }
        }
        return undefined;
    }
}

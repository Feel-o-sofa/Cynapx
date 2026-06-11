/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import SQLiteDatabase from 'better-sqlite3';
import * as fs from 'fs';
import { NodeRepository } from '../db/node-repository';
import { readRegistry, toCanonical } from '../utils/paths';
import { CodeNode, SymbolType, Visibility } from '../types';

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
        }
        this.batchDbCache = null;
    }

    private openRemoteDb(dbPath: string): SQLiteDatabase.Database | undefined {
        if (this.batchDbCache) {
            const cached = this.batchDbCache.get(dbPath);
            if (cached) return cached;
            if (!fs.existsSync(dbPath)) return undefined;
            const db = new SQLiteDatabase(dbPath, { readonly: true });
            this.batchDbCache.set(dbPath, db);
            return db;
        }
        if (!fs.existsSync(dbPath)) return undefined;
        return new SQLiteDatabase(dbPath, { readonly: true });
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
                    const remoteStmt = remoteDb.prepare(
                        'SELECT * FROM nodes WHERE qualified_name = ? COLLATE NOCASE OR qualified_name LIKE ? COLLATE NOCASE LIMIT 1'
                    );
                    const remoteMatch = remoteStmt.get(canonicalQName, `%#${symbolName}`) as RemoteNodeRow | undefined;

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
                    if (!this.batchDbCache) remoteDb.close();
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
                }
            }
        }
        return undefined;
    }
}

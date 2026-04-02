/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import SQLiteDatabase from 'better-sqlite3';
import * as fs from 'fs';
import { NodeRepository } from '../db/node-repository';
import { readRegistry, toCanonical } from '../utils/paths';
import { CodeNode } from '../types';

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
    constructor(
        private nodeRepo: NodeRepository,
        private localProjectPath: string
    ) {}

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
                if (!fs.existsSync(project.db_path)) continue;

                const remoteDb = new SQLiteDatabase(project.db_path, { readonly: true });
                try {
                    const remoteStmt = remoteDb.prepare(
                        'SELECT * FROM nodes WHERE qualified_name = ? COLLATE NOCASE OR qualified_name LIKE ? COLLATE NOCASE LIMIT 1'
                    );
                    const remoteMatch = remoteStmt.get(canonicalQName, `%#${symbolName}`) as any;

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
                    remoteDb.close();
                }
            } catch {
                // Silently ignore errors for specific remote DBs
            }
        }
        return undefined;
    }
}

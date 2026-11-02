/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Annotations are what agents record for later sessions (decisions, gotchas,
 * todos, rationale); they are not derived from the code and cannot be
 * re-indexed. Purging a project's index deletes its database file, so a purge
 * first sets the annotations aside in a file beside the database (under
 * ~/.cynapx, never in the project), and the next database created at that
 * path takes them back.
 */
import * as fs from 'fs';
import type Database from 'better-sqlite3';
import { Logger } from '../utils/logger';

const log = new Logger('AnnotationCarryover');

interface AnnotationRow {
    node_qname: string;
    kind: string;
    body: string;
    author: string | null;
    created_at: number;
    commit_hash: string | null;
}

export function annotationCarryoverPath(dbPath: string): string {
    return `${dbPath}.annotations.json`;
}

/** Writes the database's annotations beside it; returns how many were kept. */
export function setAsideAnnotations(db: Database.Database, dbPath: string): number {
    let rows: AnnotationRow[];
    try {
        rows = db.prepare('SELECT node_qname, kind, body, author, created_at, commit_hash FROM annotations ORDER BY id').all() as AnnotationRow[];
    } catch {
        return 0; // a database from before annotations existed
    }
    if (rows.length === 0) return 0;
    fs.writeFileSync(annotationCarryoverPath(dbPath), JSON.stringify(rows), { mode: 0o600 });
    return rows.length;
}

/** Inserts annotations set aside for this path, then deletes the file. Returns how many. */
export function restoreAnnotations(db: Database.Database, dbPath: string): number {
    const file = annotationCarryoverPath(dbPath);
    if (!fs.existsSync(file)) return 0;
    let rows: AnnotationRow[];
    try {
        rows = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(rows)) throw new Error('not an array');
    } catch (err) {
        // Leave the file for a human to recover rather than lose it.
        log.error(`Could not read set-aside annotations at ${file}: ${err instanceof Error ? err.message : err}`);
        return 0;
    }
    const insert = db.prepare('INSERT INTO annotations (node_qname, kind, body, author, created_at, commit_hash) VALUES (?, ?, ?, ?, ?, ?)');
    db.transaction(() => {
        for (const r of rows) insert.run(r.node_qname, r.kind, r.body, r.author ?? 'agent', r.created_at, r.commit_hash ?? null);
    })();
    fs.unlinkSync(file);
    log.info(`Restored ${rows.length} annotation(s) set aside by an earlier purge.`);
    return rows.length;
}

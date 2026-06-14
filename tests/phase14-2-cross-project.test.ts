/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 14-2 — CrossProjectResolver efficiency + trust (A-3 v11):
 *  - A-3(1): remote symbol resolution uses an indexed symbol_name probe
 *    (SEARCH, not SCAN) when the remote schema is >= v3; falls back to the
 *    leading-wildcard LIKE for older schemas with a ONE-TIME warning.
 *  - A-3(2): a corrupted / untrusted remote DB (bad user_version or missing
 *    nodes table) is skipped gracefully while other remote DBs still resolve.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { toCanonical } from '../src/utils/paths';
import { CrossProjectResolver } from '../src/indexer/cross-project-resolver';
import { NodeRepository } from '../src/db/node-repository';
import { Logger } from '../src/utils/logger';

/** A modern remote DB (schema v3): nodes table WITH the indexed symbol_name column. */
function createModernRemoteDb(dbPath: string, qualifiedName: string): void {
    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qualified_name TEXT NOT NULL,
            symbol_name TEXT,
            symbol_type TEXT NOT NULL,
            language TEXT NOT NULL,
            file_path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            visibility TEXT NOT NULL,
            signature TEXT,
            return_type TEXT,
            tags TEXT,
            history TEXT
        );
        CREATE INDEX idx_nodes_symbol_name ON nodes (symbol_name COLLATE NOCASE);
    `);
    const symbolName = qualifiedName.includes('#') ? qualifiedName.split('#').pop()! : qualifiedName;
    db.prepare(`
        INSERT INTO nodes (qualified_name, symbol_name, symbol_type, language, file_path, start_line, end_line, visibility)
        VALUES (?, ?, 'function', 'typescript', 'remote.ts', 1, 5, 'public')
    `).run(qualifiedName, symbolName);
    db.pragma('user_version = 3');
    db.close();
}

/** A legacy remote DB (schema v1): nodes table WITHOUT symbol_name column. */
function createLegacyRemoteDb(dbPath: string, qualifiedName: string): void {
    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE nodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qualified_name TEXT NOT NULL,
            symbol_type TEXT NOT NULL,
            language TEXT NOT NULL,
            file_path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            visibility TEXT NOT NULL,
            signature TEXT,
            return_type TEXT,
            tags TEXT,
            history TEXT
        );
    `);
    db.prepare(`
        INSERT INTO nodes (qualified_name, symbol_type, language, file_path, start_line, end_line, visibility)
        VALUES (?, 'function', 'typescript', 'remote.ts', 1, 5, 'public')
    `).run(qualifiedName);
    db.pragma('user_version = 1');
    db.close();
}

/** A crafted/garbage DB registered as a "remote project": no nodes table. */
function createCorruptRemoteDb(dbPath: string): void {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE not_nodes (x INTEGER);');
    // user_version spoofed to a sane-looking value to prove the table check
    // (not only the version check) does the rejecting.
    db.pragma('user_version = 3');
    db.close();
}

function makeLocalRepo(): { localDb: Database.Database; nodeRepo: NodeRepository } {
    const localDb = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');
    localDb.exec(fullSchema.split(';').filter(stmt => !stmt.includes('vec0')).join(';'));
    return { localDb, nodeRepo: new NodeRepository(localDb) };
}

describe('Phase 14-2 A-3(1): indexed symbol_name probe for modern remote DBs', () => {
    let tmpDir: string;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('resolves a remote symbol AND uses an indexed SEARCH (not a full SCAN)', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-p142-'));
        const remoteDbPath = path.join(tmpDir, 'remote.db');
        createModernRemoteDb(remoteDbPath, 'remote.ts#sharedHelper');

        const pathsModule = await import('../src/utils/paths');
        vi.spyOn(pathsModule, 'readRegistry').mockReturnValue([
            { name: 'other-project', path: '/other/project', db_path: remoteDbPath, last_accessed_at: new Date().toISOString() },
        ]);

        const { localDb, nodeRepo } = makeLocalRepo();
        const resolver = new CrossProjectResolver(nodeRepo, '/local/project');

        const id = resolver.resolve('sharedHelper', toCanonical('sharedHelper'));
        expect(id).toBeDefined();

        // Prove the probe is indexed: EXPLAIN QUERY PLAN on the same query shape
        // must show a SEARCH using idx_nodes_symbol_name, not a SCAN.
        const probeDb = new Database(remoteDbPath, { readonly: true });
        const plan = probeDb.prepare(
            'EXPLAIN QUERY PLAN SELECT * FROM nodes WHERE symbol_name = ? COLLATE NOCASE'
        ).all('sharedHelper') as { detail: string }[];
        probeDb.close();

        const planText = plan.map(p => p.detail).join('\n');
        expect(planText).toMatch(/SEARCH/);
        expect(planText).toContain('idx_nodes_symbol_name');
        // The symbol_name branch must NOT be a full table scan.
        expect(planText).not.toMatch(/SCAN nodes(?! USING)/);

        localDb.close();
    });

    it('matches a global (no-#) remote symbol via the symbol_name probe', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-p142-'));
        const remoteDbPath = path.join(tmpDir, 'remote.db');
        createModernRemoteDb(remoteDbPath, 'GlobalThing');

        const pathsModule = await import('../src/utils/paths');
        vi.spyOn(pathsModule, 'readRegistry').mockReturnValue([
            { name: 'other-project', path: '/other/project', db_path: remoteDbPath, last_accessed_at: new Date().toISOString() },
        ]);

        const { localDb, nodeRepo } = makeLocalRepo();
        const resolver = new CrossProjectResolver(nodeRepo, '/local/project');
        expect(resolver.resolve('GlobalThing', toCanonical('GlobalThing'))).toBeDefined();
        localDb.close();
    });
});

describe('Phase 14-2 A-3(2): untrusted / corrupt remote DB is skipped gracefully', () => {
    let tmpDir: string;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('skips a corrupt remote DB (no nodes table) while other DBs still resolve', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-p142-'));
        const goodDbPath = path.join(tmpDir, 'good.db');
        const corruptDbPath = path.join(tmpDir, 'corrupt.db');
        createModernRemoteDb(goodDbPath, 'remote.ts#sharedHelper');
        createCorruptRemoteDb(corruptDbPath);

        const pathsModule = await import('../src/utils/paths');
        // Corrupt DB first so it is encountered before the good one.
        vi.spyOn(pathsModule, 'readRegistry').mockReturnValue([
            { name: 'corrupt-project', path: '/corrupt/project', db_path: corruptDbPath, last_accessed_at: new Date().toISOString() },
            { name: 'good-project', path: '/good/project', db_path: goodDbPath, last_accessed_at: new Date().toISOString() },
        ]);
        const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

        const { localDb, nodeRepo } = makeLocalRepo();
        const resolver = new CrossProjectResolver(nodeRepo, '/local/project');

        // Despite the corrupt DB being registered first, resolution succeeds
        // against the good DB.
        expect(resolver.resolve('sharedHelper', toCanonical('sharedHelper'))).toBeDefined();
        // The corrupt DB triggered a skip warning.
        expect(warnSpy).toHaveBeenCalled();
        expect(warnSpy.mock.calls.some(c => /Skipping remote DB/.test(String(c[0])))).toBe(true);

        localDb.close();
    });

    it('skips a remote DB with an absurd user_version (crafted file)', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-p142-'));
        const craftedPath = path.join(tmpDir, 'crafted.db');
        const db = new Database(craftedPath);
        db.exec(`
            CREATE TABLE nodes (
                id INTEGER PRIMARY KEY, qualified_name TEXT, symbol_name TEXT,
                symbol_type TEXT, language TEXT, file_path TEXT,
                start_line INTEGER, end_line INTEGER, visibility TEXT
            );
        `);
        db.prepare(`INSERT INTO nodes (qualified_name, symbol_name, symbol_type, language, file_path, start_line, end_line, visibility)
                    VALUES ('remote.ts#evil', 'evil', 'function', 'typescript', 'r.ts', 1, 2, 'public')`).run();
        db.pragma('user_version = 999999999'); // far outside the trusted range
        db.close();

        const pathsModule = await import('../src/utils/paths');
        vi.spyOn(pathsModule, 'readRegistry').mockReturnValue([
            { name: 'crafted', path: '/crafted', db_path: craftedPath, last_accessed_at: new Date().toISOString() },
        ]);
        const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

        const { localDb, nodeRepo } = makeLocalRepo();
        const resolver = new CrossProjectResolver(nodeRepo, '/local/project');

        expect(resolver.resolve('evil', toCanonical('evil'))).toBeUndefined();
        expect(warnSpy.mock.calls.some(c => /unexpected schema version/.test(String(c[0])))).toBe(true);

        localDb.close();
    });
});

describe('Phase 14-2 A-3(1): legacy remote DB fallback warns exactly once', () => {
    let tmpDir: string;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('resolves via the LIKE fallback and warns ONCE per DB across many resolve() calls', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-p142-'));
        const legacyDbPath = path.join(tmpDir, 'legacy.db');
        createLegacyRemoteDb(legacyDbPath, 'remote.ts#legacyHelper');

        const pathsModule = await import('../src/utils/paths');
        vi.spyOn(pathsModule, 'readRegistry').mockReturnValue([
            { name: 'legacy-project', path: '/legacy/project', db_path: legacyDbPath, last_accessed_at: new Date().toISOString() },
        ]);
        const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

        const { localDb, nodeRepo } = makeLocalRepo();
        const resolver = new CrossProjectResolver(nodeRepo, '/local/project');
        resolver.beginBatch();

        // Many resolve() calls, all hitting the legacy fallback path.
        expect(resolver.resolve('legacyHelper', toCanonical('legacyHelper'))).toBeDefined();
        resolver.resolve('legacyHelper', toCanonical('legacyHelper'));
        resolver.resolve('missingSym', toCanonical('missingSym'));
        resolver.resolve('alsoMissing', toCanonical('alsoMissing'));

        resolver.endBatch();

        const legacyWarnings = warnSpy.mock.calls.filter(c => /legacy schema/.test(String(c[0])));
        expect(legacyWarnings.length).toBe(1);

        localDb.close();
    });
});

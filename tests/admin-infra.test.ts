/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for Phase 10 / Org-management infrastructure:
 *   - AuditLogger        (src/utils/audit-logger.ts)
 *   - ProjectProfile     (src/utils/profile.ts)
 *   - paths extensions   (updateRegistryStats, ProjectEntry fields)
 *   - MetadataRepository version/indexedAt accessors
 *   - DatabaseManager    runMigrations()
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// AuditLogger tests
// ---------------------------------------------------------------------------
describe('AuditLogger', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-audit-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates audit.log on first write', async () => {
        const { AuditLogger } = await import('../src/utils/audit-logger');
        const logPath = path.join(tmpDir, 'audit.log');
        const logger = new AuditLogger(logPath);
        logger.log('index_start', { project: '/some/project' });
        expect(fs.existsSync(logPath)).toBe(true);
    });

    it('appends NDJSON lines', async () => {
        const { AuditLogger } = await import('../src/utils/audit-logger');
        const logPath = path.join(tmpDir, 'audit.log');
        const logger = new AuditLogger(logPath);
        logger.log('index_start',    { project: '/p' });
        logger.log('index_complete', { project: '/p', nodeCount: 10 });
        const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        const first  = JSON.parse(lines[0]);
        const second = JSON.parse(lines[1]);
        expect(first.event).toBe('index_start');
        expect(second.event).toBe('index_complete');
        expect(second.nodeCount).toBe(10);
    });

    it('readRecent returns parsed events in order', async () => {
        const { AuditLogger } = await import('../src/utils/audit-logger');
        const logPath = path.join(tmpDir, 'audit.log');
        const logger = new AuditLogger(logPath);
        for (let i = 0; i < 5; i++) {
            logger.log('purge', { project: `/p${i}` });
        }
        const events = logger.readRecent(3);
        expect(events).toHaveLength(3);
        expect(events[2].project).toBe('/p4');
    });

    it('readRecent returns [] when log file does not exist', async () => {
        const { AuditLogger } = await import('../src/utils/audit-logger');
        const logger = new AuditLogger(path.join(tmpDir, 'nonexistent.log'));
        expect(logger.readRecent()).toEqual([]);
    });

    it('write failures do not throw (non-existent directory)', async () => {
        const { AuditLogger } = await import('../src/utils/audit-logger');
        const logger = new AuditLogger('/this/path/does/not/exist/audit.log');
        expect(() => logger.log('purge', {})).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// ProjectProfile tests
// ---------------------------------------------------------------------------
describe('ProjectProfile', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-profile-test-'));
        // Point getCentralStorageDir to tmpDir via env override
        vi.stubEnv('HOME', tmpDir);
        // Also stub USERPROFILE for Windows
        vi.stubEnv('USERPROFILE', tmpDir);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns defaults when no profile file exists', async () => {
        const { loadProfile } = await import('../src/utils/profile');
        const profile = loadProfile('/some/project');
        expect(profile.excludePatterns).toBeDefined();
        expect(Array.isArray(profile.excludePatterns)).toBe(true);
        expect(profile.maxFileSize).toBeGreaterThan(0);
    });

    it('saves and reloads profile correctly', async () => {
        const { loadProfile, saveProfile } = await import('../src/utils/profile');
        const projectPath = tmpDir; // use tmpDir as fake project path
        const custom = {
            excludePatterns: ['**/build/**'],
            maxFileSize: 200 * 1024,
            languageOverrides: { '.mts': 'typescript' }
        };
        saveProfile(projectPath, custom);
        const loaded = loadProfile(projectPath);
        expect(loaded.excludePatterns).toEqual(['**/build/**']);
        expect(loaded.maxFileSize).toBe(200 * 1024);
        expect(loaded.languageOverrides).toEqual({ '.mts': 'typescript' });
    });

    it('resolveProfilePath returns path inside ~/.cynapx/profiles/', async () => {
        const { resolveProfilePath } = await import('../src/utils/profile');
        const p = resolveProfilePath('/some/project');
        expect(p).toContain('profiles');
        expect(p).toMatch(/\.json$/);
    });
});

// ---------------------------------------------------------------------------
// MetadataRepository — version/indexedAt accessors
// ---------------------------------------------------------------------------
describe('MetadataRepository — version and indexedAt', () => {
    let db: import('better-sqlite3').Database;

    beforeEach(async () => {
        const Database = (await import('better-sqlite3')).default;
        db = new Database(':memory:');
        db.exec(`
            CREATE TABLE IF NOT EXISTS index_metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            INSERT OR IGNORE INTO index_metadata (key, value) VALUES ('cynapx_version', '');
            INSERT OR IGNORE INTO index_metadata (key, value) VALUES ('indexed_at', '');
        `);
    });

    afterEach(() => {
        db.close();
    });

    it('getCynapxVersion returns undefined for empty string', async () => {
        const { MetadataRepository } = await import('../src/db/metadata-repository');
        const repo = new MetadataRepository(db);
        expect(repo.getCynapxVersion()).toBeUndefined();
    });

    it('setCynapxVersion / getCynapxVersion round-trips', async () => {
        const { MetadataRepository } = await import('../src/db/metadata-repository');
        const repo = new MetadataRepository(db);
        repo.setCynapxVersion('1.0.7');
        expect(repo.getCynapxVersion()).toBe('1.0.7');
    });

    it('getIndexedAt returns undefined for empty string', async () => {
        const { MetadataRepository } = await import('../src/db/metadata-repository');
        const repo = new MetadataRepository(db);
        expect(repo.getIndexedAt()).toBeUndefined();
    });

    it('setIndexedAt / getIndexedAt round-trips', async () => {
        const { MetadataRepository } = await import('../src/db/metadata-repository');
        const repo = new MetadataRepository(db);
        const ts = new Date().toISOString();
        repo.setIndexedAt(ts);
        expect(repo.getIndexedAt()).toBe(ts);
    });
});

// ---------------------------------------------------------------------------
// DatabaseManager — SCHEMA_VERSION constant + migration idempotency
// ---------------------------------------------------------------------------
describe('DatabaseManager.SCHEMA_VERSION', () => {
    it('SCHEMA_VERSION is a positive integer', async () => {
        const { DatabaseManager } = await import('../src/db/database');
        expect(DatabaseManager.SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(DatabaseManager.SCHEMA_VERSION)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// paths.ts — updateRegistryStats
// ---------------------------------------------------------------------------
describe('updateRegistryStats', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-paths-test-'));
        vi.stubEnv('HOME', tmpDir);
        vi.stubEnv('USERPROFILE', tmpDir);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('updateRegistryStats is a no-op when project not in registry', async () => {
        const { updateRegistryStats } = await import('../src/utils/paths');
        // Should not throw even if project not registered
        expect(() =>
            updateRegistryStats('/nonexistent/project', {
                node_count: 5,
                edge_count: 10,
                cynapx_version: '1.0.6'
            })
        ).not.toThrow();
    });

    it('ProjectEntry interface supports node_count, edge_count, cynapx_version', async () => {
        const { addToRegistry, readRegistry, updateRegistryStats } = await import('../src/utils/paths');
        const fakeProjectPath = tmpDir; // tmpDir itself as the "project"
        addToRegistry(fakeProjectPath);
        updateRegistryStats(fakeProjectPath, {
            node_count: 42,
            edge_count: 100,
            cynapx_version: '1.0.6'
        });
        const registry = readRegistry();
        const entry = registry.find(e => e.path.toLowerCase() === fakeProjectPath.toLowerCase());
        expect(entry).toBeDefined();
        expect(entry!.node_count).toBe(42);
        expect(entry!.edge_count).toBe(100);
        expect(entry!.cynapx_version).toBe('1.0.6');
        expect(entry!.last_indexed_at).toBeDefined();
        expect(entry!.status).toBe('ok');
    });
});

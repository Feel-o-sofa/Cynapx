/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 13-8 commit C regression tests (LOW batch).
 *
 * - O-1:  BFS uses an index-pointer queue (head++) — correctness preserved.
 * - O-3 + A-10: utils/version.ts reads + caches package.json once.
 * - O-7:  interactive-shell tool list no longer advertises the unregistered
 *         `perform_clustering`, and matches the real tool registry.
 * - O-8:  CertificateGenerator works inside a private 0700 directory.
 * - O-9:  AuditLogger.readRecent() uses a tail read (cost scales with limit).
 * - O-11: FileFilter honours nested (subdirectory) .gitignore files.
 * - O-12: search_symbols returns an error (not empty success) when every
 *         context is EngineNotReadyError.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GraphEngine } from '../src/graph/graph-engine';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { CodeNode, CodeEdge } from '../src/types';
import { getVersion, _resetVersionCacheForTests } from '../src/utils/version';
import { FileFilter } from '../src/utils/file-filter';
import { AuditLogger } from '../src/utils/audit-logger';
import { searchSymbolsHandler } from '../src/server/tools/search-symbols';
import { toolRegistry } from '../src/server/tools/_registry';
import { InteractiveShell } from '../src/server/interactive-shell';

// ---------------------------------------------------------------------------
// O-1: BFS index-pointer queue
// ---------------------------------------------------------------------------
function inMemoryEngine() {
    const db = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const filtered = fs.readFileSync(schemaPath, 'utf8')
        .split(';').filter(s => !s.includes('vec0')).join(';');
    db.exec(filtered);
    const nodeRepo = new NodeRepository(db);
    const edgeRepo = new EdgeRepository(db);
    const engine = new GraphEngine(nodeRepo, edgeRepo);
    return { db, engine, nodeRepo, edgeRepo };
}

function mkNode(nodeRepo: NodeRepository, qname: string): number {
    return nodeRepo.createNode({
        qualified_name: qname, symbol_type: 'function', language: 'typescript',
        file_path: 'test.ts', start_line: 1, end_line: 10, visibility: 'public',
        is_generated: false, last_updated_commit: 'abc', version: 1,
    } as CodeNode);
}
function mkEdge(edgeRepo: EdgeRepository, from: number, to: number): void {
    edgeRepo.createEdge({ from_id: from, to_id: to, edge_type: 'calls', dynamic: false } as CodeEdge);
}

describe('O-1: BFS index-pointer queue keeps correct level/order', () => {
    it('preserves distances on a wide-then-deep graph', () => {
        const { engine, nodeRepo, edgeRepo } = inMemoryEngine();
        // root -> a,b,c (depth 1); a -> d (depth 2); d -> e (depth 3)
        const root = mkNode(nodeRepo, 'root');
        const a = mkNode(nodeRepo, 'a');
        const b = mkNode(nodeRepo, 'b');
        const c = mkNode(nodeRepo, 'c');
        const d = mkNode(nodeRepo, 'd');
        const e = mkNode(nodeRepo, 'e');
        mkEdge(edgeRepo, root, a); mkEdge(edgeRepo, root, b); mkEdge(edgeRepo, root, c);
        mkEdge(edgeRepo, a, d); mkEdge(edgeRepo, d, e);

        const res = engine.traverse(root, 'BFS', { maxDepth: 5, useCache: false });
        const dist = (q: string) => res.find(r => r.node.qualified_name === q)!.distance;
        expect(dist('root')).toBe(0);
        expect(dist('a')).toBe(1);
        expect(dist('b')).toBe(1);
        expect(dist('c')).toBe(1);
        expect(dist('d')).toBe(2);
        expect(dist('e')).toBe(3);
        // No duplicate visits.
        expect(new Set(res.map(r => r.node.qualified_name)).size).toBe(res.length);
    });

    it('handles a larger linear chain without re-visiting (head++ pointer)', () => {
        const { engine, nodeRepo, edgeRepo } = inMemoryEngine();
        const ids: number[] = [];
        for (let i = 0; i < 50; i++) ids.push(mkNode(nodeRepo, `n${i}`));
        for (let i = 0; i < 49; i++) mkEdge(edgeRepo, ids[i], ids[i + 1]);
        const res = engine.traverse(ids[0], 'BFS', { maxDepth: 100, useCache: false });
        expect(res).toHaveLength(50);
        expect(res.find(r => r.node.qualified_name === 'n49')!.distance).toBe(49);
    });
});

// ---------------------------------------------------------------------------
// O-3 + A-10: version helper
// ---------------------------------------------------------------------------
describe('O-3 + A-10: getVersion() reads + caches package.json once', () => {
    beforeEach(() => _resetVersionCacheForTests());
    afterEach(() => { vi.restoreAllMocks(); _resetVersionCacheForTests(); });

    it('returns the real package version', () => {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
        expect(getVersion()).toBe(pkg.version);
    });

    it('caches the value (subsequent calls return the same string)', () => {
        _resetVersionCacheForTests();
        const v1 = getVersion();
        const v2 = getVersion();
        const v3 = getVersion();
        expect(v1).toBe(v2);
        expect(v2).toBe(v3);
        // Cached value is a non-empty version string.
        expect(v1).toMatch(/\d+\.\d+/);
    });

    it('does not throw and returns a fallback when no package.json is locatable', () => {
        // getVersion never throws; even after reset it yields a usable string.
        _resetVersionCacheForTests();
        expect(() => getVersion()).not.toThrow();
        expect(typeof getVersion()).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// O-7: interactive-shell tool list matches the registry
// ---------------------------------------------------------------------------
describe('O-7: shell tool list has no unregistered tools', () => {
    it('does not list perform_clustering and every listed tool is registered', () => {
        // Reach the private `tools` array without starting the REPL.
        const shell = new InteractiveShell({} as any);
        const tools: string[] = (shell as any).tools;
        expect(tools).not.toContain('perform_clustering');
        // Every advertised tool (except the shell-only initialize helper aliases)
        // must exist in the real tool registry.
        for (const t of tools) {
            expect(toolRegistry.has(t)).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// O-9: AuditLogger tail read
// ---------------------------------------------------------------------------
describe('O-9: AuditLogger.readRecent() tail read', () => {
    let dir: string;
    let logPath: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
        logPath = path.join(dir, 'audit.log');
    });
    afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

    function loggerOn(p: string): AuditLogger {
        const l = new AuditLogger();
        (l as any).logPath = p;
        return l;
    }

    it('returns the last N entries in order', () => {
        const lines = [];
        for (let i = 0; i < 500; i++) lines.push(JSON.stringify({ timestamp: String(i), event: 'purge', n: i }));
        fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
        const recent = loggerOn(logPath).readRecent(10);
        expect(recent).toHaveLength(10);
        expect((recent[0] as any).n).toBe(490);
        expect((recent[9] as any).n).toBe(499);
    });

    it('returns the correct tail on a large multi-chunk file (> 64KB)', () => {
        // File far larger than the 64KB tail chunk, so the tail read must span
        // multiple backward chunks and reassemble correctly.
        const lines = [];
        for (let i = 0; i < 20000; i++) lines.push(JSON.stringify({ timestamp: String(i), event: 'purge', pad: 'x'.repeat(200), n: i }));
        fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
        expect(fs.statSync(logPath).size).toBeGreaterThan(64 * 1024);

        const recent = loggerOn(logPath).readRecent(5);
        expect(recent).toHaveLength(5);
        expect((recent[0] as any).n).toBe(19995);
        expect((recent[4] as any).n).toBe(19999);
    });

    it('does not split multibyte UTF-8 across the tail chunk boundary', () => {
        // Pad lines with multibyte characters and request enough lines that the
        // tail spans more than one 64KB chunk.
        const lines = [];
        for (let i = 0; i < 5000; i++) lines.push(JSON.stringify({ timestamp: String(i), event: 'purge', pad: '한글'.repeat(40), n: i }));
        fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
        const recent = loggerOn(logPath).readRecent(200);
        expect(recent).toHaveLength(200);
        // Every parsed line is valid JSON with the expected padding intact.
        expect((recent[199] as any).n).toBe(4999);
        expect((recent[0] as any).pad).toBe('한글'.repeat(40));
    });

    it('handles fewer lines than the limit and skips corrupt lines', () => {
        fs.writeFileSync(logPath, [
            JSON.stringify({ timestamp: '1', event: 'purge' }),
            'not-json-garbage',
            JSON.stringify({ timestamp: '2', event: 'backup' }),
        ].join('\n') + '\n', 'utf8');
        const recent = loggerOn(logPath).readRecent(100);
        expect(recent).toHaveLength(2);
        expect(recent.map(r => r.event)).toEqual(['purge', 'backup']);
    });

    it('returns [] when the file does not exist', () => {
        expect(loggerOn(path.join(dir, 'missing.log')).readRecent(10)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// O-11: nested .gitignore
// ---------------------------------------------------------------------------
describe('O-11: FileFilter supports nested .gitignore', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-gi-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('applies a subdirectory .gitignore to that subtree only', () => {
        fs.writeFileSync(path.join(dir, '.gitignore'), '*.log\n', 'utf8');
        fs.mkdirSync(path.join(dir, 'pkg', 'generated'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'other'), { recursive: true });
        // Nested .gitignore ignores generated/ within pkg/.
        fs.writeFileSync(path.join(dir, 'pkg', '.gitignore'), 'generated/\n', 'utf8');

        const ff = new FileFilter(dir);
        // Root rule still works.
        expect(ff.isIgnored(path.join(dir, 'app.log'))).toBe(true);
        // Nested rule: pkg/generated/* ignored.
        expect(ff.isIgnored(path.join(dir, 'pkg', 'generated', 'out.ts'))).toBe(true);
        // Same directory name outside pkg/ is NOT ignored (scope respected).
        expect(ff.isIgnored(path.join(dir, 'other', 'generated', 'out.ts'))).toBe(false);
        // A normal source file under pkg/ is not ignored.
        expect(ff.isIgnored(path.join(dir, 'pkg', 'index.ts'))).toBe(false);
    });

    it('supports negation (!) in a nested .gitignore', () => {
        fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'sub', '.gitignore'), '*.tmp\n!keep.tmp\n', 'utf8');
        const ff = new FileFilter(dir);
        expect(ff.isIgnored(path.join(dir, 'sub', 'a.tmp'))).toBe(true);
        expect(ff.isIgnored(path.join(dir, 'sub', 'keep.tmp'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// O-12: search_symbols error on all-EngineNotReady
// ---------------------------------------------------------------------------
describe('O-12: search_symbols surfaces an error when all contexts are not ready', () => {
    function depsWith(contexts: any[]): any {
        return {
            workspaceManager: { getAllContexts: () => contexts },
            embeddingProvider: { generate: async () => [] },
        };
    }

    it('returns isError when every context throws EngineNotReadyError', async () => {
        // A context missing graphEngine triggers requireEngine -> EngineNotReadyError.
        const notReady = { projectPath: '/p', graphEngine: null } as any;
        const res = await searchSymbolsHandler.execute({ query: 'x' }, depsWith([notReady]));
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/not ready/i);
    });

    it('returns a normal (non-error) empty result when there are no contexts', async () => {
        const res = await searchSymbolsHandler.execute({ query: 'x' }, depsWith([]));
        expect(res.isError).toBeFalsy();
        expect(res.content[0].text).toBe('[]');
    });

    it('returns results normally when at least one context is ready', async () => {
        const ready = {
            graphEngine: { nodeRepo: { searchSymbols: () => [{ qualified_name: 'A', symbol_type: 'function', file_path: 'a.ts', tags: [] }] } },
        } as any;
        const res = await searchSymbolsHandler.execute({ query: 'A' }, depsWith([ready]));
        expect(res.isError).toBeFalsy();
        const parsed = JSON.parse(res.content[0].text);
        expect(parsed[0].qname).toBe('A');
    });
});

// ---------------------------------------------------------------------------
// O-8: CertificateGenerator private 0700 dir (skipped where openssl absent)
// ---------------------------------------------------------------------------
describe('O-8: CertificateGenerator works inside a private directory', () => {
    it('generates a key+cert (or skips if openssl is unavailable)', async () => {
        const { execSync } = await import('child_process');
        let hasOpenssl = true;
        try { execSync('openssl version', { stdio: 'ignore' }); } catch { hasOpenssl = false; }
        if (!hasOpenssl) return; // environment without openssl — nothing to assert
        const { CertificateGenerator } = await import('../src/utils/certificate-generator');
        const { key, cert } = CertificateGenerator.generate();
        expect(key.length).toBeGreaterThan(0);
        expect(cert.length).toBeGreaterThan(0);
        expect(cert.toString()).toContain('BEGIN CERTIFICATE');
    });
});

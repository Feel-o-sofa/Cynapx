/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Tests for P7 — Richer Test Linkage: schema migration 5 -> 6, TestSpec
 * extraction (it()/test() titles + expect() assertions), assertion
 * normalization, pipeline persistence/deletion, and the get_related_tests /
 * get_symbol_details tool handlers surfacing captured behavior.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager } from '../src/db/database';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { GraphEngine } from '../src/graph/graph-engine';
import { UpdatePipeline } from '../src/indexer/update-pipeline';
import { TypeScriptParser } from '../src/indexer/typescript-parser';
import { getRelatedTestsHandler } from '../src/server/tools/get-related-tests';
import { getSymbolDetailsHandler } from '../src/server/tools/get-symbol-details';
import type { CodeNode } from '../src/types';
import type { DeltaGraph, CodeParser } from '../src/indexer/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadFilteredSchema(db: Database.Database): void {
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');
    const filtered = fullSchema.split(';').filter(s => !s.includes('vec0')).join(';');
    db.exec(filtered);
}

function createInMemoryEngine() {
    const db = new Database(':memory:');
    loadFilteredSchema(db);
    const nodeRepo = new NodeRepository(db);
    const edgeRepo = new EdgeRepository(db);
    const engine = new GraphEngine(nodeRepo, edgeRepo);
    return { db, engine, nodeRepo, edgeRepo };
}

function makeNode(nodeRepo: NodeRepository, qname: string, filePath: string, symbolType: string = 'function'): number {
    return nodeRepo.createNode({
        qualified_name: qname,
        symbol_type: symbolType as any,
        language: 'typescript',
        file_path: filePath,
        start_line: 1,
        end_line: 10,
        visibility: 'public',
        is_generated: false,
        last_updated_commit: 'abc',
        version: 1,
    } as CodeNode);
}

/** Extract test specs from inline source via the parser's emitTestEdges. */
function extractSpecs(testContent: string, testFilePath: string, prodFileQname: string): any[] {
    const parser = new TypeScriptParser();
    const sf = ts.createSourceFile(testFilePath, testContent, ts.ScriptTarget.Latest, true);
    // Resolve to the production file qname regardless of disk layout by stubbing
    // the resolution helpers so emitTestEdges runs the spec-walk pass.
    (parser as any).inferProductionFilePath = () => '/src/calc.ts';
    (parser as any).resolveProductionFile = () => '/src/calc.ts';
    const edges: any[] = [];
    const specs: any[] = [];
    (parser as any).emitTestEdges(sf, testFilePath, 'tests/calc.test.ts', edges, specs);
    return specs;
}

// ---------------------------------------------------------------------------
// 1. Schema migration 5 -> 6
// ---------------------------------------------------------------------------
describe('P7 schema migration 5 -> 6', () => {
    it('a fresh DB is at SCHEMA_VERSION 6 with the test_specs table', () => {
        expect(DatabaseManager.SCHEMA_VERSION).toBe(6);
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        const version = db.pragma('user_version', { simple: true }) as number;
        expect(version).toBe(6);

        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_specs'").get();
        expect(table).toBeDefined();
        manager.dispose();
    });

    it('creates the test_specs indices', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        const idxTest = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_test_specs_test_qname'").get();
        const idxTarget = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_test_specs_target_qname'").get();
        expect(idxTest).toBeDefined();
        expect(idxTarget).toBeDefined();
        manager.dispose();
    });

    it('migrates an older DB (version 5) up to 6, creating test_specs', () => {
        // Simulate a pre-P7 DB: schema present but user_version pinned at 5.
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        db.exec('DROP TABLE IF EXISTS test_specs');
        db.pragma('user_version = 5');

        manager.runMigrations();

        expect(db.pragma('user_version', { simple: true })).toBe(6);
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_specs'").get();
        expect(table).toBeDefined();
        manager.dispose();
    });

    it('test_specs has the expected columns', () => {
        const manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        const cols = (db.prepare('PRAGMA table_info(test_specs)').all() as { name: string }[]).map(c => c.name);
        expect(cols).toEqual(
            expect.arrayContaining(['id', 'test_qname', 'title', 'target_qname', 'assertions', 'file_path', 'start_line'])
        );
        manager.dispose();
    });
});

// ---------------------------------------------------------------------------
// 2. TestSpec extraction
// ---------------------------------------------------------------------------
describe('P7 TestSpec extraction', () => {
    it('extracts it() titles and target from the enclosing describe', () => {
        const content = `
describe('Calculator — arithmetic', () => {
    it('adds two numbers', () => {
        const result = add(1, 2);
        expect(result).toBe(3);
    });
    test('multiplies', () => {
        expect(multiply(2, 3)).toBe(6);
    });
});
`;
        const specs = extractSpecs(content, '/tests/calc.test.ts', '/src/calc.ts');
        expect(specs).toHaveLength(2);
        const titles = specs.map(s => s.title);
        expect(titles).toContain('adds two numbers');
        expect(titles).toContain('multiplies');
        // Target resolves to the leading PascalCase identifier of the describe.
        expect(specs[0].targetQname).toBe('/src/calc.ts#Calculator');
    });

    it('captures expect() assertions', () => {
        const content = `
describe('Calculator', () => {
    it('adds', () => {
        expect(add(1, 2)).toBe(3);
        expect(add(0, 0)).toBe(0);
    });
});
`;
        const specs = extractSpecs(content, '/tests/calc.test.ts', '/src/calc.ts');
        expect(specs).toHaveLength(1);
        expect(specs[0].assertions).toContain('expect(add(1, 2)).toBe(3)');
        expect(specs[0].assertions).toContain('expect(add(0, 0)).toBe(0)');
    });

    it('records start line and test qname / file path', () => {
        const content = `describe('Calc', () => {\n  it('x', () => { expect(1).toBe(1); });\n});\n`;
        const specs = extractSpecs(content, '/tests/calc.test.ts', '/src/calc.ts');
        expect(specs[0].testQname).toBe('tests/calc.test.ts');
        expect(specs[0].filePath).toBe('/tests/calc.test.ts');
        expect(specs[0].startLine).toBe(2);
    });

    it('produces no specs for an empty test file', () => {
        const specs = extractSpecs('// nothing here\n', '/tests/empty.test.ts', '/src/calc.ts');
        expect(specs).toEqual([]);
    });

    it('handles it.each() forms', () => {
        const content = `
describe('Calc', () => {
    it.each([[1,2,3]])('adds %i + %i', (a, b, c) => {
        expect(add(a, b)).toBe(c);
    });
});
`;
        const specs = extractSpecs(content, '/tests/calc.test.ts', '/src/calc.ts');
        expect(specs.some(s => s.title === 'adds %i + %i')).toBe(true);
    });

    it('resolves the target from nested describe blocks', () => {
        const content = `
describe('OuterThing', () => {
    describe('Calculator — nested', () => {
        it('adds', () => { expect(add(1,1)).toBe(2); });
    });
});
`;
        const specs = extractSpecs(content, '/tests/calc.test.ts', '/src/calc.ts');
        const adds = specs.find(s => s.title === 'adds');
        expect(adds.targetQname).toBe('/src/calc.ts#Calculator');
    });

    it('does not leak assertions across sibling it() blocks', () => {
        const content = `
describe('Calc', () => {
    it('first', () => { expect(a).toBe(1); });
    it('second', () => { expect(b).toBe(2); });
});
`;
        const specs = extractSpecs(content, '/tests/calc.test.ts', '/src/calc.ts');
        const first = specs.find(s => s.title === 'first');
        const second = specs.find(s => s.title === 'second');
        expect(first.assertions).toEqual(['expect(a).toBe(1)']);
        expect(second.assertions).toEqual(['expect(b).toBe(2)']);
    });
});

// ---------------------------------------------------------------------------
// 3. Assertion normalization
// ---------------------------------------------------------------------------
describe('P7 assertion normalization', () => {
    function assertionsOf(body: string): string[] {
        const content = `describe('Calc', () => { it('t', () => { ${body} }); });`;
        return extractSpecs(content, '/tests/calc.test.ts', '/src/calc.ts')[0].assertions;
    }

    it('normalizes toBe with first arg', () => {
        expect(assertionsOf('expect(result).toBe(42);')).toContain('expect(result).toBe(42)');
    });

    it('normalizes a no-arg matcher like toThrow', () => {
        expect(assertionsOf('expect(fn).toThrow();')).toContain('expect(fn).toThrow()');
    });

    it('normalizes toHaveLength', () => {
        expect(assertionsOf('expect(arr).toHaveLength(3);')).toContain('expect(arr).toHaveLength(3)');
    });

    it('keeps the .not modifier prefix', () => {
        expect(assertionsOf('expect(x).not.toBe(5);')).toContain('expect(x).not.toBe(5)');
    });

    it('truncates very long args', () => {
        const longArg = '"' + 'a'.repeat(200) + '"';
        const out = assertionsOf(`expect(x).toBe(${longArg});`)[0];
        expect(out.length).toBeLessThan(120);
        expect(out).toContain('…');
    });

    it('ignores non-expect call expressions', () => {
        const out = assertionsOf('doSomething(); console.log("hi");');
        expect(out).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// 4. Pipeline persistence / deletion
// ---------------------------------------------------------------------------
describe('P7 pipeline persistence', () => {
    function makePipeline() {
        const { db, engine, nodeRepo, edgeRepo } = createInMemoryEngine();
        const stubParser: CodeParser = { supports: () => true, parse: async () => ({ nodes: [], edges: [] }) };
        const pipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, stubParser, undefined, undefined, undefined, undefined, engine);
        (pipeline as any).embeddingManager = { refreshAll: async () => undefined, isAvailable: false };
        return { db, pipeline, nodeRepo };
    }

    it('writes test_specs on applyDelta', async () => {
        const { db, pipeline } = makePipeline();
        const delta: DeltaGraph = {
            nodes: [],
            edges: [],
            testSpecs: [
                { testQname: 'tests/calc.test.ts', title: 'adds', targetQname: '/src/calc.ts#Calculator', assertions: ['expect(add(1,1)).toBe(2)'], filePath: '/tests/calc.test.ts', startLine: 3 },
            ],
        };
        await pipeline.applyDelta('/tests/calc.test.ts', delta, 'ADD');

        const rows = db.prepare('SELECT * FROM test_specs').all() as any[];
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('adds');
        expect(JSON.parse(rows[0].assertions)).toEqual(['expect(add(1,1)).toBe(2)']);
    });

    it('replaces test_specs for the same file on MODIFY', async () => {
        const { db, pipeline } = makePipeline();
        await pipeline.applyDelta('/tests/calc.test.ts', {
            nodes: [], edges: [],
            testSpecs: [{ testQname: 'tests/calc.test.ts', title: 'old', assertions: [], filePath: '/tests/calc.test.ts', startLine: 1 }],
        }, 'ADD');

        await pipeline.applyDelta('/tests/calc.test.ts', {
            nodes: [], edges: [],
            testSpecs: [{ testQname: 'tests/calc.test.ts', title: 'new', assertions: [], filePath: '/tests/calc.test.ts', startLine: 1 }],
        }, 'MODIFY');

        const rows = db.prepare('SELECT title FROM test_specs').all() as { title: string }[];
        expect(rows.map(r => r.title)).toEqual(['new']);
    });

    it('clears stale test_specs on MODIFY with no new specs', async () => {
        const { db, pipeline } = makePipeline();
        await pipeline.applyDelta('/tests/calc.test.ts', {
            nodes: [], edges: [],
            testSpecs: [{ testQname: 'tests/calc.test.ts', title: 'old', assertions: [], filePath: '/tests/calc.test.ts', startLine: 1 }],
        }, 'ADD');
        // File modified to no longer be a test (or all its() removed).
        await pipeline.applyDelta('/tests/calc.test.ts', { nodes: [], edges: [], testSpecs: [] }, 'MODIFY');
        expect((db.prepare('SELECT COUNT(*) AS n FROM test_specs').get() as any).n).toBe(0);
    });

    it('deletes test_specs on applyDeleteSerial', async () => {
        const { db, pipeline } = makePipeline();
        await pipeline.applyDelta('/tests/calc.test.ts', {
            nodes: [], edges: [],
            testSpecs: [{ testQname: 'tests/calc.test.ts', title: 'x', assertions: [], filePath: '/tests/calc.test.ts', startLine: 1 }],
        }, 'ADD');

        await pipeline.applyDeleteSerial('/tests/calc.test.ts');
        expect((db.prepare('SELECT COUNT(*) AS n FROM test_specs').get() as any).n).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 5. get_related_tests returns specs
// ---------------------------------------------------------------------------
describe('P7 get_related_tests tool', () => {
    function seedSpec(db: Database.Database, targetQname: string, filePath: string) {
        db.prepare(
            'INSERT INTO test_specs (test_qname, title, target_qname, assertions, file_path, start_line) VALUES (?, ?, ?, ?, ?, ?)'
        ).run('tests/calc.test.ts', 'adds two numbers', targetQname, JSON.stringify(['expect(add(1,1)).toBe(2)']), filePath, 3);
    }

    it('returns both tests and specs for a symbol', async () => {
        const { db, engine, nodeRepo } = createInMemoryEngine();
        makeNode(nodeRepo, 'src/calc.ts#Calculator', 'src/calc.ts', 'class');
        seedSpec(db, 'src/calc.ts#Calculator', 'tests/calc.test.ts');

        const deps: any = { getContext: () => ({ graphEngine: engine }) };
        const res = await getRelatedTestsHandler.execute({ qualified_name: 'src/calc.ts#Calculator' }, deps);
        const payload = JSON.parse(res.content[0].text);

        expect(payload).toHaveProperty('tests');
        expect(payload).toHaveProperty('specs');
        expect(payload.specs).toHaveLength(1);
        expect(payload.specs[0].title).toBe('adds two numbers');
        expect(payload.specs[0].assertions).toEqual(['expect(add(1,1)).toBe(2)']);
        expect(payload.specs[0].location).toBe('tests/calc.test.ts:3');
    });

    it('also surfaces file-level specs for a non-file symbol', async () => {
        const { db, engine, nodeRepo } = createInMemoryEngine();
        // Symbol whose file canonical qname is src/calc.ts.
        makeNode(nodeRepo, 'src/calc.ts#add', 'src/calc.ts', 'function');
        // Spec linked to the file-level qname, not the symbol.
        seedSpec(db, 'src/calc.ts', 'tests/calc.test.ts');

        const deps: any = { getContext: () => ({ graphEngine: engine }) };
        const res = await getRelatedTestsHandler.execute({ qualified_name: 'src/calc.ts#add' }, deps);
        const payload = JSON.parse(res.content[0].text);
        expect(payload.specs.some((s: any) => s.title === 'adds two numbers')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 6. get_symbol_details shows Verified Behavior
// ---------------------------------------------------------------------------
describe('P7 get_symbol_details Verified Behavior', () => {
    it('renders a Verified Behavior section when specs exist', async () => {
        const { db, engine, nodeRepo } = createInMemoryEngine();
        makeNode(nodeRepo, 'src/calc.ts#Calculator', 'src/calc.ts', 'class');
        db.prepare(
            'INSERT INTO test_specs (test_qname, title, target_qname, assertions, file_path, start_line) VALUES (?, ?, ?, ?, ?, ?)'
        ).run('tests/calc.test.ts', 'adds two numbers', 'src/calc.ts#Calculator', JSON.stringify(['expect(add(1,1)).toBe(2)']), 'tests/calc.test.ts', 3);

        const deps: any = { getContext: () => ({ graphEngine: engine }) };
        const res = await getSymbolDetailsHandler.execute(
            { qualified_name: 'src/calc.ts#Calculator', include_source: false }, deps
        );
        const text = res.content[0].text;
        expect(text).toContain('#### Verified Behavior:');
        expect(text).toContain('adds two numbers');
        expect(text).toContain('expect(add(1,1)).toBe(2)');
    });

    it('omits the section when there are no specs', async () => {
        const { engine, nodeRepo } = createInMemoryEngine();
        makeNode(nodeRepo, 'src/calc.ts#Calculator', 'src/calc.ts', 'class');

        const deps: any = { getContext: () => ({ graphEngine: engine }) };
        const res = await getSymbolDetailsHandler.execute(
            { qualified_name: 'src/calc.ts#Calculator', include_source: false }, deps
        );
        expect(res.content[0].text).not.toContain('Verified Behavior');
    });
});

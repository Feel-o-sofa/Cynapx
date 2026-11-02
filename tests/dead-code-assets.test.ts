/**
 * #21: find_dead_code reported 486 symbols on a ~5,500-line Python app whose
 * real dead code was one function: JSON keys, locale strings and Markdown
 * sections were judged by call fan-in, which cannot apply to them. The
 * fixture reproduces that shape (tests/fixtures/deadcode-assets) and is
 * indexed end to end through the real pipeline.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseManager } from '../src/db/database';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { UpdatePipeline } from '../src/indexer/update-pipeline';
import { createDefaultParser } from '../src/indexer/default-parser';
import { GraphEngine } from '../src/graph/graph-engine';
import { OptimizationEngine } from '../src/graph/optimization-engine';
import { toCanonical } from '../src/utils/paths';
import type { OptimizationReport } from '../src/types';

const ROOT = path.resolve(__dirname, 'fixtures', 'deadcode-assets');

function listFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true })
        .flatMap(e => e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

describe('find_dead_code on a code + data-asset project (#21)', () => {
    let manager: DatabaseManager;
    let report: OptimizationReport;
    let specCount: number;
    const rel = (q: string) => q.slice(toCanonical(ROOT).length + 1);

    beforeAll(async () => {
        manager = new DatabaseManager(':memory:');
        const db = manager.getDb();
        const nodeRepo = new NodeRepository(db);
        const edgeRepo = new EdgeRepository(db);
        const pipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, createDefaultParser());
        (pipeline as any).embeddingManager = { refreshAll: async () => {}, isAvailable: false };
        await pipeline.processBatch(listFiles(ROOT).map(file_path => ({ event: 'ADD' as const, file_path, commit: 'c' })), 1);
        report = await new OptimizationEngine(new GraphEngine(nodeRepo, edgeRepo)).findDeadCode();
        specCount = (db.prepare('SELECT COUNT(*) AS c FROM test_specs').get() as { c: number }).c;
    });

    afterAll(() => manager.close?.());

    it('reports only functions and methods that nothing calls', () => {
        expect(report.high.map(n => rel(n.qualified_name))).toEqual([]);
        expect(report.medium.map(n => rel(n.qualified_name))).toEqual(['app/palette_parser.py#_unused_helper']);
        expect(report.low.map(n => rel(n.qualified_name))).toEqual(['app/palette_parser.py#remove_background_ai_torch']);
    });

    it('sets aside functions referenced by name but never called by name', () => {
        // `_on_click` is registered in a dict (a callback): no call edge, but
        // its name occurs elsewhere.
        const names = [...report.high, ...report.medium, ...report.low].map(n => rel(n.qualified_name));
        expect(names).not.toContain('app/main.py#_on_click');
        expect(report.summary.referencedByName).toBe(1);
    });

    it('sees a call through a variable typed by assignment', () => {
        // `strings = LocaleManager(...)` then `strings.get(...)`: resolved since
        // 4.3.0, so `get` is neither reported nor set aside.
        const names = [...report.high, ...report.medium, ...report.low].map(n => rel(n.qualified_name));
        expect(names).not.toContain('app/locale_manager.py#localemanager.get');
    });

    it('does not judge data assets, and says how many it left out', () => {
        const reported = [...report.high, ...report.medium, ...report.low];
        expect(reported.filter(n => /\.(json|md)$/.test(n.file_path))).toEqual([]);
        expect(report.summary.notAnalyzed).toBeGreaterThan(15);
    });

    it('excludes implicitly called code: dunders, decorated, local functions, main, test files', () => {
        const names = [...report.high, ...report.medium, ...report.low].map(n => rel(n.qualified_name));
        for (const excluded of [
            'app/locale_manager.py#localemanager.__init__',
            'app/locale_manager.py#localemanager.__repr__',
            'app/locale_manager.py#localemanager.language',
            'app/main.py#palette_view',
            'app/main.py#wrap',
            'app/main.py#main',
            'tests/test_palette.py#helper_only_tests_use',
        ]) expect(names).not.toContain(excluded);
    });

    it('stores test specs on the batch path (initial index, git sync), not only the watcher path', () => {
        // Before this fix processBatch dropped them, so test files were neither
        // linked by get_related_tests nor recognized here.
        expect(specCount).toBe(1);
    });
});

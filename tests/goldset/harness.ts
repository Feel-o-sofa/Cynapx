/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * Call-edge gold-set harness: indexes a fixture project end to end through the
 * real UpdatePipeline (shared parser set, pipeline edge resolution) into an
 * in-memory database and reads back the `calls` edges, so precision and recall
 * reflect what get_callers / analyze_impact actually serve.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseManager } from '../../src/db/database';
import { NodeRepository } from '../../src/db/node-repository';
import { EdgeRepository } from '../../src/db/edge-repository';
import { UpdatePipeline } from '../../src/indexer/update-pipeline';
import { createDefaultParser } from '../../src/indexer/default-parser';
import { toCanonical } from '../../src/utils/paths';
import type { FileChangeEvent } from '../../src/indexer/types';

export const GOLDSET_DIR = path.resolve(__dirname, '..', 'fixtures', 'goldset');

/**
 * A symbol is identified by where it is defined — "<fixture-relative file>:<line>" —
 * not by Cynapx's qualified name. Naming schemes can conflate distinct symbols
 * (a method and a same-named free function in one file share one qname in the
 * tree-sitter languages); keying on the definition site makes such collapses
 * show up as misses instead of being baked into the "truth", and keeps the gold
 * set valid if the naming scheme changes.
 */
export type SymbolKey = string;
/** "<caller SymbolKey> -> <callee SymbolKey>". */
export type EdgeKey = string;

export interface GoldSet {
    language: string;
    /**
     * Ground truth: every call from a project symbol to a project symbol, as
     * ["<file>:<line> <label>", "<file>:<line> <label>"]. The label after the
     * first space is for humans and ignored by scoring.
     */
    edges: [string, string][];
    /** Why each tricky case is in the fixture (documentation only). */
    cases?: Record<string, string>;
}

export interface IndexedFixture {
    /** SymbolKey -> Cynapx qualified name(s) defined there. */
    symbols: Map<SymbolKey, string[]>;
    callEdges: EdgeKey[];
}

export interface Score {
    language: string;
    gold: number;
    predicted: number;
    truePositives: EdgeKey[];
    falsePositives: EdgeKey[];
    falseNegatives: EdgeKey[];
    precision: number;
    recall: number;
}

function listFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(full));
        else if (entry.name !== 'gold.json') out.push(full);
    }
    return out.sort();
}

/** Strips the fixture's absolute (canonical) prefix so keys are stable across machines. */
function relativize(qname: string, root: string): string {
    const prefix = toCanonical(root) + '/';
    return qname.startsWith(prefix) ? qname.slice(prefix.length) : qname;
}

export async function indexFixture(language: string): Promise<IndexedFixture> {
    const root = path.join(GOLDSET_DIR, language);
    const manager = new DatabaseManager(':memory:');
    const db = manager.getDb();
    try {
        const nodeRepo = new NodeRepository(db);
        const edgeRepo = new EdgeRepository(db);
        // No projectPath: cross-project resolution would consult other indexed
        // projects in ~/.cynapx and make the measurement machine-dependent.
        const pipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, createDefaultParser());
        (pipeline as any).embeddingManager = { refreshAll: async () => {}, isAvailable: false };

        const events: FileChangeEvent[] = listFiles(root).map(file_path => ({ event: 'ADD', file_path, commit: 'gold' }));
        await pipeline.processBatch(events, 1);

        const key = (file: string, line: number): SymbolKey => `${relativize(toCanonical(file), root)}:${line}`;
        const symbols = new Map<SymbolKey, string[]>();
        for (const r of db.prepare('SELECT qualified_name, file_path, start_line FROM nodes').all() as { qualified_name: string; file_path: string; start_line: number }[]) {
            const k = key(r.file_path, r.start_line);
            symbols.set(k, [...(symbols.get(k) ?? []), relativize(r.qualified_name, root)]);
        }
        const callEdges = (db.prepare(`
            SELECT f.file_path AS sf, f.start_line AS sl, t.file_path AS tf, t.start_line AS tl
            FROM edges e JOIN nodes f ON f.id = e.from_id JOIN nodes t ON t.id = e.to_id
            WHERE e.edge_type = 'calls'`).all() as { sf: string; sl: number; tf: string; tl: number }[])
            .map(r => `${key(r.sf, r.sl)} -> ${key(r.tf, r.tl)}`);
        return { symbols, callEdges: [...new Set(callEdges)].sort() };
    } finally {
        manager.close?.();
    }
}

export function loadGold(language: string): GoldSet {
    return JSON.parse(fs.readFileSync(path.join(GOLDSET_DIR, language, 'gold.json'), 'utf8'));
}

export function score(gold: GoldSet, indexed: IndexedFixture): Score {
    const site = (labelled: string) => labelled.split(' ')[0].toLowerCase();
    const goldKeys = new Set(gold.edges.map(([a, b]) => `${site(a)} -> ${site(b)}`));
    const predicted = new Set(indexed.callEdges);
    const truePositives = [...predicted].filter(e => goldKeys.has(e)).sort();
    const falsePositives = [...predicted].filter(e => !goldKeys.has(e)).sort();
    const falseNegatives = [...goldKeys].filter(e => !predicted.has(e)).sort();
    return {
        language: gold.language,
        gold: goldKeys.size,
        predicted: predicted.size,
        truePositives,
        falsePositives,
        falseNegatives,
        precision: predicted.size === 0 ? 0 : truePositives.length / predicted.size,
        recall: goldKeys.size === 0 ? 0 : truePositives.length / goldKeys.size,
    };
}

export function goldsetLanguages(): string[] {
    return fs.readdirSync(GOLDSET_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && fs.existsSync(path.join(GOLDSET_DIR, d.name, 'gold.json')))
        .map(d => d.name)
        .sort();
}

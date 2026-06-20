/**
 * Benchmark: tree-sitter parsing speed for TypeScript source files.
 *
 * Measures the time to parse a TypeScript fixture file using the TypeScript
 * language provider — mirrors the hot path in TreeSitterParser.parse().
 */
import { bench, describe, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import Parser from 'tree-sitter';
import { typescriptDescriptor } from '../../src/indexer/languages/typescript';
import { createLanguageProvider } from '../../src/indexer/languages';
import type { LanguageProvider } from '../../src/indexer/types';

const FIXTURES = path.resolve(__dirname, '../fixtures');
const SAMPLE_TS = path.join(FIXTURES, 'sample.ts');

let provider: LanguageProvider;
let sourceCode: string;
let parser: Parser;

beforeAll(() => {
    provider = createLanguageProvider(typescriptDescriptor);
    sourceCode = fs.readFileSync(SAMPLE_TS, 'utf8');
    parser = new Parser();
    parser.setLanguage(provider.getLanguage());
});

describe('tree-sitter parsing — TypeScript', () => {
    bench('parse sample.ts (full parse + query)', () => {
        const tree = parser.parse(sourceCode);
        const query = new Parser.Query(provider.getLanguage(), provider.getQuery());
        const matches = query.matches(tree.rootNode);
        // Consume the matches to prevent dead-code elimination
        let count = 0;
        for (const match of matches) count += match.captures.length;
        return count;
    });

    bench('parse sample.ts (parse only, no query)', () => {
        parser.parse(sourceCode);
    });
});

// ---------------------------------------------------------------------------
// O-4 (Phase 13-8): TypeScriptParser semantic parse — LanguageService reuse.
//
// The TypeScriptParser drives a full ts type-checker. Before O-4 it called
// ts.createProgram() fresh per file, re-reading the lib.*.d.ts every time; now
// it reuses a single incremental LanguageService across files in a run. This
// benchmark contrasts a cold parser (one instance per file) against a warm
// parser (reused across files) over the same fixture set.
// ---------------------------------------------------------------------------
describe('TypeScriptParser semantic parse — O-4 LanguageService reuse', () => {
    const os = require('os') as typeof import('os');
    const { TypeScriptParser } = require('../../src/indexer/typescript-parser') as typeof import('../../src/indexer/typescript-parser');

    let dir: string;
    let files: string[];

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o4-bench-'));
        files = [];
        for (let i = 0; i < 5; i++) {
            const p = path.join(dir, `mod${i}.ts`);
            fs.writeFileSync(p, fs.readFileSync(SAMPLE_TS, 'utf8'), 'utf8');
            files.push(p);
        }
    });

    bench('parse 5 files with a REUSED parser (warm LanguageService)', async () => {
        const p = new TypeScriptParser();
        for (const f of files) await p.parse(f, 'c1', 1);
    });

    bench('parse 5 files each with a FRESH parser (cold LanguageService)', async () => {
        for (const f of files) {
            const p = new TypeScriptParser();
            await p.parse(f, 'c1', 1);
        }
    });
});

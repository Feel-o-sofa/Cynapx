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
import { TypescriptProvider } from '../../src/indexer/languages/typescript';
import type { LanguageProvider } from '../../src/indexer/types';

const FIXTURES = path.resolve(__dirname, '../fixtures');
const SAMPLE_TS = path.join(FIXTURES, 'sample.ts');

let provider: LanguageProvider;
let sourceCode: string;
let parser: Parser;

beforeAll(() => {
    provider = new TypescriptProvider();
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

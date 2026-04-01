/**
 * Golden / snapshot tests for tree-sitter parsing across four languages.
 *
 * Strategy: instantiate each language provider directly (bypassing the lazy
 * LanguageRegistry which relies on runtime `require()` of .ts files) and drive
 * the same parse pipeline that TreeSitterParser uses.  This means the tests
 * have no database dependency and no heavy setup.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import Parser from 'tree-sitter';
import { TypescriptProvider } from '../src/indexer/languages/typescript';
import { PythonProvider } from '../src/indexer/languages/python';
import { JavascriptProvider } from '../src/indexer/languages/javascript';
import { GoProvider } from '../src/indexer/languages/go';
import type { LanguageProvider } from '../src/indexer/types';

const FIXTURES = path.resolve(__dirname, 'fixtures');

function fixturePath(filename: string): string {
    return path.join(FIXTURES, filename);
}

// ---------------------------------------------------------------------------
// Mini parse helper — mirrors the core of TreeSitterParser.parse() but without
// the DB / checksum / path-canonicalisation ceremony that would produce
// machine-specific output in snapshots.
// ---------------------------------------------------------------------------

interface ParsedCapture {
    captureName: string;
    text: string;
    startLine: number;
    endLine: number;
}

function parseFixture(filePath: string, provider: LanguageProvider): ParsedCapture[] {
    const parser = new Parser();
    parser.setLanguage(provider.getLanguage());

    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const tree = parser.parse(sourceCode);
    const query = new Parser.Query(provider.getLanguage(), provider.getQuery());
    const matches = query.matches(tree.rootNode);

    const captures: ParsedCapture[] = [];
    for (const match of matches) {
        for (const capture of match.captures) {
            captures.push({
                captureName: capture.name,
                text: capture.node.text,
                startLine: capture.node.startPosition.row + 1,
                endLine: capture.node.endPosition.row + 1,
            });
        }
    }
    return captures;
}

/** Return unique texts for captures whose name contains the given keyword. */
function captureTexts(captures: ParsedCapture[], keyword: string): string[] {
    return [...new Set(
        captures
            .filter(c => c.captureName.includes(keyword))
            .map(c => c.text)
    )].sort();
}

// ─── TypeScript ──────────────────────────────────────────────────────────────

describe('tree-sitter parser — TypeScript (sample.ts)', () => {
    const provider = new TypescriptProvider();
    const captures = parseFixture(fixturePath('sample.ts'), provider);

    it('snapshot: all captures', () => {
        // Strip line numbers so snapshots are stable if we add blank lines.
        const summary = captures.map(c => ({ name: c.captureName, text: c.text }));
        expect(summary).toMatchSnapshot();
    });

    it('finds class names: Animal and Dog', () => {
        const names = captureTexts(captures, 'class.name');
        expect(names).toContain('Animal');
        expect(names).toContain('Dog');
    });

    it('finds method names: speak, greet, fetchBreed, constructor', () => {
        const names = captureTexts(captures, 'method.name');
        expect(names).toContain('speak');
        expect(names).toContain('greet');
        expect(names).toContain('fetchBreed');
        expect(names).toContain('constructor');
    });

    it('finds standalone function formatAnimal', () => {
        const names = captureTexts(captures, 'function.name');
        expect(names).toContain('formatAnimal');
    });

    it('captures relation.inherits for "Animal" (Dog extends Animal)', () => {
        const inherits = captureTexts(captures, 'relation.inherits');
        expect(inherits).toContain('Animal');
    });

    it('captures relation.implements for "Greetable"', () => {
        const impl = captureTexts(captures, 'relation.implements');
        expect(impl).toContain('Greetable');
    });

    it('captures the import source string for "events"', () => {
        const importSources = captureTexts(captures, 'import.name');
        expect(importSources.some(s => s.includes('events'))).toBe(true);
    });
});

// ─── Python ──────────────────────────────────────────────────────────────────

describe('tree-sitter parser — Python (sample.py)', () => {
    const provider = new PythonProvider();
    const captures = parseFixture(fixturePath('sample.py'), provider);

    it('snapshot: all captures', () => {
        const summary = captures.map(c => ({ name: c.captureName, text: c.text }));
        expect(summary).toMatchSnapshot();
    });

    it('finds class names: Animal and Dog', () => {
        const names = captureTexts(captures, 'class.name');
        expect(names).toContain('Animal');
        expect(names).toContain('Dog');
    });

    it('finds method names: __init__, speak, fetch_breed', () => {
        const names = captureTexts(captures, 'function.name');
        // Python queries treat all def as function.def — methods live inside classes
        expect(names).toContain('__init__');
        expect(names).toContain('speak');
        expect(names).toContain('fetch_breed');
    });

    it('finds the standalone function format_animal', () => {
        const names = captureTexts(captures, 'function.name');
        expect(names).toContain('format_animal');
    });

    it('captures relation.inherits for "Animal" (Dog(Animal))', () => {
        const inherits = captureTexts(captures, 'relation.inherits');
        expect(inherits).toContain('Animal');
    });

    it('captures import statements for os and pathlib', () => {
        const importCaptures = captures.filter(c => c.captureName.includes('import'));
        // The raw import node text includes the module name
        const allText = importCaptures.map(c => c.text).join(' ');
        expect(allText).toContain('os');
        expect(allText).toContain('pathlib');
    });
});

// ─── JavaScript ──────────────────────────────────────────────────────────────

describe('tree-sitter parser — JavaScript (sample.js)', () => {
    const provider = new JavascriptProvider();
    const captures = parseFixture(fixturePath('sample.js'), provider);

    it('snapshot: all captures', () => {
        const summary = captures.map(c => ({ name: c.captureName, text: c.text }));
        expect(summary).toMatchSnapshot();
    });

    it('finds class names: Animal and Dog', () => {
        const names = captureTexts(captures, 'class.name');
        expect(names).toContain('Animal');
        expect(names).toContain('Dog');
    });

    it('finds method names: constructor, speak, fetchBreed', () => {
        const names = captureTexts(captures, 'method.name');
        expect(names).toContain('constructor');
        expect(names).toContain('speak');
        expect(names).toContain('fetchBreed');
    });

    it('finds standalone function formatAnimal', () => {
        const names = captureTexts(captures, 'function.name');
        expect(names).toContain('formatAnimal');
    });

    it('captures the require("path") call expression', () => {
        const calls = captureTexts(captures, 'call.name');
        expect(calls).toContain('require');
    });
});

// ─── Go ──────────────────────────────────────────────────────────────────────

describe('tree-sitter parser — Go (sample.go)', () => {
    const provider = new GoProvider();
    const captures = parseFixture(fixturePath('sample.go'), provider);

    it('snapshot: all captures', () => {
        const summary = captures.map(c => ({ name: c.captureName, text: c.text }));
        expect(summary).toMatchSnapshot();
    });

    it('finds struct type names: Animal and Dog', () => {
        const names = captureTexts(captures, 'class.name');
        expect(names).toContain('Animal');
        expect(names).toContain('Dog');
    });

    it('finds method names: Speak, FetchBreed', () => {
        const names = captureTexts(captures, 'method.name');
        expect(names).toContain('Speak');
        expect(names).toContain('FetchBreed');
    });

    it('finds standalone function FormatAnimal', () => {
        const names = captureTexts(captures, 'function.name');
        expect(names).toContain('FormatAnimal');
    });

    it('captures import paths for fmt and strings', () => {
        const imports = captureTexts(captures, 'import.name');
        expect(imports.some(s => s.includes('fmt'))).toBe(true);
        expect(imports.some(s => s.includes('strings'))).toBe(true);
    });
});

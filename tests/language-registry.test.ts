/**
 * Phase 12-7 A-5: data-driven language registry.
 *
 * Verifies that the declarative LANGUAGE_DESCRIPTORS array is the single
 * source of truth: every descriptor builds a working provider through the
 * common factory, every registered extension resolves to a provider via the
 * LanguageRegistry, and no language was lost in the class → descriptor
 * refactor.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';
import { LANGUAGE_DESCRIPTORS, createLanguageProvider } from '../src/indexer/languages';
import { LanguageRegistry } from '../src/indexer/language-registry';

const QUERIES_DIR = path.resolve(__dirname, '../src/indexer/languages/queries');

const EXPECTED_LANGUAGES = [
    'c', 'cpp', 'csharp', 'gdscript', 'go', 'java',
    'javascript', 'kotlin', 'php', 'python', 'rust', 'typescript'
];

describe('LANGUAGE_DESCRIPTORS — declarative single source of truth', () => {
    it('contains every built-in language exactly once', () => {
        const names = LANGUAGE_DESCRIPTORS.map(d => d.name).sort();
        expect(names).toEqual(EXPECTED_LANGUAGES);
    });

    it('descriptors are plain data objects, not provider classes', () => {
        for (const d of LANGUAGE_DESCRIPTORS) {
            // Registration is driven by descriptor data — there is no class
            // (and no class-name string inference) involved.
            expect(typeof d).toBe('object');
            expect(typeof d.name).toBe('string');
            expect(typeof d.grammarModule).toBe('string');
            expect(d.grammarModule.startsWith('tree-sitter-')).toBe(true);
            expect(typeof d.queryFile).toBe('string');
            expect(Array.isArray(d.captureMap)).toBe(true);
            expect(d.decisionPoints.length).toBeGreaterThan(0);
        }
    });

    it('extensions are lowercase, non-empty and owned by exactly one descriptor', () => {
        const seen = new Map<string, string>();
        for (const d of LANGUAGE_DESCRIPTORS) {
            expect(d.extensions.length).toBeGreaterThan(0);
            for (const ext of d.extensions) {
                expect(ext).toBe(ext.toLowerCase());
                expect(seen.has(ext), `extension '${ext}' claimed by both '${seen.get(ext)}' and '${d.name}'`).toBe(false);
                seen.set(ext, d.name);
            }
        }
    });

    it('every descriptor references an existing query file', () => {
        for (const d of LANGUAGE_DESCRIPTORS) {
            const queryPath = path.join(QUERIES_DIR, d.queryFile);
            expect(fs.existsSync(queryPath), `missing query file for '${d.name}': ${queryPath}`).toBe(true);
        }
    });
});

describe('createLanguageProvider — common factory', () => {
    for (const descriptor of LANGUAGE_DESCRIPTORS) {
        it(`builds a working provider for '${descriptor.name}'`, () => {
            const provider = createLanguageProvider(descriptor);

            expect(provider.languageName).toBe(descriptor.name);
            expect(provider.extensions).toEqual([...descriptor.extensions]);

            // Grammar loads and the query compiles against it.
            const language = provider.getLanguage();
            expect(language).toBeTruthy();
            const queryText = provider.getQuery();
            expect(queryText.length).toBeGreaterThan(0);
            expect(() => new Parser.Query(language, queryText)).not.toThrow();

            // Capture mapping follows the descriptor's ordered prefix rules.
            for (const [prefix, type] of descriptor.captureMap) {
                expect(provider.mapCaptureToSymbolType(`${prefix}.name`)).toBe(type);
            }
            expect(provider.mapCaptureToSymbolType('__no_such_capture__')).toBe(descriptor.defaultSymbolType);

            expect(provider.getDecisionPoints()).toEqual([...descriptor.decisionPoints]);
        });
    }
});

describe('LanguageRegistry — descriptor-driven registration', () => {
    it('resolves every descriptor extension to the right provider', () => {
        const registry = LanguageRegistry.getInstance();
        for (const d of LANGUAGE_DESCRIPTORS) {
            for (const ext of d.extensions) {
                const provider = registry.getProvider(`some/file.${ext}`);
                expect(provider, `no provider for .${ext} (${d.name})`).toBeDefined();
                expect(provider!.languageName).toBe(d.name);
            }
        }
    });

    it('getAllExtensions() covers every descriptor extension', () => {
        const all = LanguageRegistry.getInstance().getAllExtensions();
        for (const d of LANGUAGE_DESCRIPTORS) {
            for (const ext of d.extensions) {
                expect(all, `getAllExtensions() missing '${ext}' (${d.name})`).toContain(ext);
            }
        }
    });

    it('extension lookup is case-insensitive', () => {
        const registry = LanguageRegistry.getInstance();
        expect(registry.getProvider('Main.PY')?.languageName).toBe('python');
        expect(registry.getProvider('Widget.Hpp')?.languageName).toBe('cpp');
        expect(registry.getProvider('Main.TS')?.languageName).toBe('typescript');
    });

    // M-1 v28 (P31-1): gate the extension-extraction edge cases of
    // getProvider() — the extension→language mapping invoked on every file
    // indexing operation. These assertions are pinned to empirically verified
    // outputs (npx tsx) so a regression in the split('.').pop()/!ext guard is
    // caught deterministically. Prod code is unchanged (test-only gate).
    it('returns undefined for a file with no extension (Makefile)', () => {
        const registry = LanguageRegistry.getInstance();
        // 'Makefile'.split('.').pop() === 'makefile' → extensionMap miss → undefined
        expect(registry.getProvider('Makefile')).toBeUndefined();
    });

    it('returns undefined for an unknown extension (foo.xyz)', () => {
        const registry = LanguageRegistry.getInstance();
        expect(registry.getProvider('foo.xyz')).toBeUndefined();
    });

    it('returns undefined for a dotfile with no real extension (.gitignore)', () => {
        const registry = LanguageRegistry.getInstance();
        // '.gitignore'.split('.').pop() === 'gitignore' → extensionMap miss → undefined
        expect(registry.getProvider('.gitignore')).toBeUndefined();
    });

    it('returns undefined for a trailing-dot filename (foo.)', () => {
        const registry = LanguageRegistry.getInstance();
        // 'foo.'.split('.').pop() === '' → falsy → early-return undefined (line 113)
        expect(registry.getProvider('foo.')).toBeUndefined();
    });

    it('resolves multi-dot filenames by the last component', () => {
        const registry = LanguageRegistry.getInstance();
        // 'gz' is not registered → undefined
        expect(registry.getProvider('archive.tar.gz')).toBeUndefined();
        // 'ts' IS registered → typescript
        expect(registry.getProvider('component.test.ts')?.languageName).toBe('typescript');
        expect(registry.getProvider('a.b.py')?.languageName).toBe('python');
    });

    it('resolves a path-containing filename deterministically', () => {
        const registry = LanguageRegistry.getInstance();
        expect(registry.getProvider('src/path/to/file.py')?.languageName).toBe('python');
    });
});

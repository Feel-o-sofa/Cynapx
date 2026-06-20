/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * P8-4: Per-language docstring normalization for the tree-sitter parser.
 *
 * Each supported language can attach an optional `normalizeDocstring(raw)`
 * function to its LanguageDescriptor (wired onto the LanguageProvider by
 * createLanguageProvider). The generic single-regex stripper in
 * extractTreeSitterDocstring did not cleanly handle Rust `///`/`//!` doc
 * comments, C# `/// <summary>` XML doc comments, or GDScript `##` doc
 * comments. These normalizers strip comment markers / documentation syntax
 * so the stored docstring is clean semantic text.
 *
 * These tests:
 *   - exercise each normalizer (Rust, C#, Go, GDScript) directly,
 *   - confirm extractTreeSitterDocstring uses a provider's normalizer when
 *     present and falls back to the generic regex when absent,
 *   - cover empty / whitespace-only edge cases.
 *
 * The normalizers are pure string-in/string-out functions, so the gates are
 * deterministic and require no DB / grammar / filesystem access.
 */
import { describe, it, expect } from 'vitest';
import { rustDescriptor } from '../src/indexer/languages/rust';
import { csharpDescriptor } from '../src/indexer/languages/csharp';
import { goDescriptor } from '../src/indexer/languages/go';
import { gdscriptDescriptor } from '../src/indexer/languages/gdscript';
import { createLanguageProvider } from '../src/indexer/languages';
import { TreeSitterParser } from '../src/indexer/tree-sitter-parser';
import type { LanguageProvider } from '../src/indexer/types';

// Helper: invoke the private extractTreeSitterDocstring through a cast. We
// build a minimal stand-in for a tree-sitter SyntaxNode that exposes only the
// fields the method reads (previousNamedSibling, firstNamedChild, type, text).
function makeCommentSiblingNode(commentText: string): any {
    const prev = {
        type: 'comment',
        text: commentText,
        firstNamedChild: null,
    };
    return {
        previousNamedSibling: prev,
        firstNamedChild: null,
    };
}

function extractDocstring(node: any, provider?: LanguageProvider): string | undefined {
    const parser = new TreeSitterParser();
    return (parser as any).extractTreeSitterDocstring(node, provider);
}

describe('normalizeDocstring (per-language)', () => {
    describe('Rust', () => {
        const normalize = rustDescriptor.normalizeDocstring!;

        it('is defined', () => {
            expect(typeof normalize).toBe('function');
        });

        it('strips /// outer doc comment markers', () => {
            expect(normalize('/// A short summary.')).toBe('A short summary.');
        });

        it('strips //! inner doc comment markers', () => {
            expect(normalize('//! Crate level docs')).toBe('Crate level docs');
        });

        it('strips markers across multiple lines', () => {
            const raw = '/// Line one\n/// Line two';
            expect(normalize(raw)).toBe('Line one\nLine two');
        });

        it('handles indented doc comments', () => {
            expect(normalize('    /// indented')).toBe('indented');
        });

        it('returns empty string for empty / whitespace-only input', () => {
            expect(normalize('')).toBe('');
            expect(normalize('   \n  ')).toBe('');
            expect(normalize('///')).toBe('');
        });
    });

    describe('C#', () => {
        const normalize = csharpDescriptor.normalizeDocstring!;

        it('is defined', () => {
            expect(typeof normalize).toBe('function');
        });

        it('strips /// prefixes and XML doc tags', () => {
            const raw = '/// <summary>\n/// Adds two numbers.\n/// </summary>';
            expect(normalize(raw)).toBe('Adds two numbers.');
        });

        it('strips param / returns tags and collapses whitespace', () => {
            const raw =
                '/// <summary>Compute sum.</summary>\n' +
                '/// <param name="a">First.</param>\n' +
                '/// <returns>The total.</returns>';
            expect(normalize(raw)).toBe('Compute sum. First. The total.');
        });

        it('returns empty string for empty / whitespace-only / tags-only input', () => {
            expect(normalize('')).toBe('');
            expect(normalize('   ')).toBe('');
            expect(normalize('/// <summary></summary>')).toBe('');
        });
    });

    describe('Go', () => {
        const normalize = goDescriptor.normalizeDocstring!;

        it('is defined', () => {
            expect(typeof normalize).toBe('function');
        });

        it('strips // line comment markers', () => {
            const raw = '// Foo does a thing.\n// And another.';
            expect(normalize(raw)).toBe('Foo does a thing.\nAnd another.');
        });

        it('returns empty string for empty / whitespace-only input', () => {
            expect(normalize('')).toBe('');
            expect(normalize('  \n ')).toBe('');
            expect(normalize('//')).toBe('');
        });
    });

    describe('GDScript', () => {
        const normalize = gdscriptDescriptor.normalizeDocstring!;

        it('is defined', () => {
            expect(typeof normalize).toBe('function');
        });

        it('strips ## doc comment markers', () => {
            const raw = '## A node helper.\n## More detail.';
            expect(normalize(raw)).toBe('A node helper.\nMore detail.');
        });

        it('returns empty string for empty / whitespace-only input', () => {
            expect(normalize('')).toBe('');
            expect(normalize('   ')).toBe('');
            expect(normalize('##')).toBe('');
        });
    });
});

describe('createLanguageProvider wiring', () => {
    it('exposes normalizeDocstring on providers whose descriptor defines it', () => {
        const provider = createLanguageProvider(rustDescriptor);
        expect(typeof provider.normalizeDocstring).toBe('function');
        expect(provider.normalizeDocstring!('/// hi')).toBe('hi');
    });
});

describe('extractTreeSitterDocstring', () => {
    it('uses the provider normalizer when present (Rust)', () => {
        const provider = createLanguageProvider(rustDescriptor);
        const node = makeCommentSiblingNode('/// documented function');
        expect(extractDocstring(node, provider)).toBe('documented function');
    });

    it('uses the provider normalizer when present (C# XML doc)', () => {
        const provider = createLanguageProvider(csharpDescriptor);
        const node = makeCommentSiblingNode('/// <summary>Does work.</summary>');
        expect(extractDocstring(node, provider)).toBe('Does work.');
    });

    it('falls back to the generic regex when no provider is given', () => {
        const node = makeCommentSiblingNode('/** A JSDoc block. */');
        expect(extractDocstring(node)).toBe('A JSDoc block.');
    });

    it('falls back to the generic regex when provider has no normalizer', () => {
        const bareProvider = {
            extensions: [],
            languageName: 'fake',
            getLanguage: () => ({}),
            getQuery: () => '',
            mapCaptureToSymbolType: () => 'function',
            getDecisionPoints: () => [],
        } as unknown as LanguageProvider;
        const node = makeCommentSiblingNode('// a plain line comment');
        expect(extractDocstring(node, bareProvider)).toBe('a plain line comment');
    });

    it('returns undefined when the normalized text is empty', () => {
        const provider = createLanguageProvider(goDescriptor);
        const node = makeCommentSiblingNode('//');
        expect(extractDocstring(node, provider)).toBeUndefined();
    });

    it('returns undefined when there is no leading comment or docstring', () => {
        const node = { previousNamedSibling: null, firstNamedChild: null };
        expect(extractDocstring(node)).toBeUndefined();
    });
});

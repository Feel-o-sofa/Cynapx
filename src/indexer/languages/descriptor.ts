/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge, TestSpec } from '../types';
import { SymbolType } from '../../types';
import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Ordered capture-name prefix rules. The first entry whose prefix matches
 * (via String.startsWith) determines the SymbolType of a capture.
 */
export type CaptureMap = ReadonlyArray<readonly [prefix: string, type: SymbolType]>;

/**
 * Declarative description of a built-in language. The descriptor array in
 * `./index.ts` is the single source of truth for which languages exist and
 * which file extensions they own; `LanguageRegistry` iterates it and builds
 * providers through `createLanguageProvider()` — no per-language classes and
 * no class-name string inference.
 */
export interface LanguageDescriptor {
    /** Language name reported on parsed nodes (becomes LanguageProvider.languageName). */
    name: string;
    /** File extensions (lowercase, without dot) handled by this language. */
    extensions: readonly string[];
    /** npm module that ships the tree-sitter grammar, e.g. 'tree-sitter-python'. Loaded lazily. */
    grammarModule: string;
    /** Named export inside grammarModule when the grammar is not the module root (e.g. 'typescript', 'php'). */
    grammarExport?: string;
    /** Query file name inside `src/indexer/languages/queries/`. */
    queryFile: string;
    /** Ordered prefix → SymbolType rules for mapCaptureToSymbolType(). */
    captureMap: CaptureMap;
    /** Fallback SymbolType when no captureMap prefix matches. */
    defaultSymbolType: SymbolType;
    /** Syntax node types counted as decision points for complexity metrics. */
    decisionPoints: readonly string[];
    /**
     * Optional language-specific import/relation edge extraction. This is the
     * one genuinely per-language piece of logic, so it stays a function on the
     * descriptor rather than being force-flattened into data.
     */
    resolveImport?: (node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string, absFilePath?: string) => void;
    /**
     * Optional language-specific docstring normalizer. Strips comment markers
     * and documentation syntax (e.g. Rust `///`, C# XML doc tags) so the stored
     * docstring is clean semantic text. When absent, a generic regex fallback
     * is used in the parser.
     */
    normalizeDocstring?: (raw: string) => string;
    /**
     * Optional per-language test-spec extraction. Given the parsed syntax tree
     * root and file context, returns the test specifications (test functions,
     * their assertions, and best-effort target symbols) found in the file.
     * Language-specific because each ecosystem has its own test conventions
     * (pytest def test_*, Go func TestXxx, Rust #[test], JUnit @Test).
     */
    extractTestSpecs?: (root: Parser.SyntaxNode, filePath: string, fileQname: string) => TestSpec[];
    /**
     * Optional owner lookup for definitions that are not nested inside their
     * type, e.g. Go methods, whose receiver names the type. Returns the owning
     * type's name, which qualifies the definition as `file#Type.method`.
     * Definitions nested in a captured class need no hook.
     */
    ownerTypeName?: (defNode: Parser.SyntaxNode) => string | undefined;
    /**
     * Optional name of a method's receiver variable when the language lets the
     * author choose it (Go: `func (c *Client) Run()` → `c`). Calls through it
     * resolve like `self`/`this` calls.
     */
    receiverName?: (defNode: Parser.SyntaxNode) => string | undefined;
    /**
     * True when a bare call inside a class body may name a member of that class
     * (Java, Kotlin, C#, C++: `foo()` means `this.foo()`). False or absent for
     * languages where it always names a free function (Python, Rust, Go, JS).
     */
    implicitMemberCalls?: boolean;
}

const QUERIES_DIR = path.resolve(__dirname, 'queries');

/**
 * Common factory: build a LanguageProvider from a declarative descriptor.
 * The native grammar module is required lazily on first getLanguage() call
 * and cached afterwards.
 */
export function createLanguageProvider(descriptor: LanguageDescriptor): LanguageProvider {
    let grammar: unknown;

    const provider: LanguageProvider = {
        extensions: [...descriptor.extensions],
        languageName: descriptor.name,

        getLanguage() {
            if (grammar === undefined) {
                // Lazy require so registering a language costs nothing until
                // a file of that language is actually parsed.
                const mod = require(descriptor.grammarModule);
                grammar = descriptor.grammarExport ? mod[descriptor.grammarExport] : mod;
            }
            return grammar;
        },

        getQuery(): string {
            return fs.readFileSync(path.join(QUERIES_DIR, descriptor.queryFile), 'utf8');
        },

        mapCaptureToSymbolType(captureName: string): SymbolType {
            for (const [prefix, type] of descriptor.captureMap) {
                if (captureName.startsWith(prefix)) return type;
            }
            return descriptor.defaultSymbolType;
        },

        getDecisionPoints(): string[] {
            return [...descriptor.decisionPoints];
        }
    };

    if (descriptor.resolveImport) {
        provider.resolveImport = descriptor.resolveImport;
    }

    if (descriptor.normalizeDocstring) {
        provider.normalizeDocstring = descriptor.normalizeDocstring;
    }

    if (descriptor.extractTestSpecs) {
        provider.extractTestSpecs = descriptor.extractTestSpecs;
    }

    if (descriptor.ownerTypeName) {
        provider.ownerTypeName = descriptor.ownerTypeName;
    }

    if (descriptor.receiverName) {
        provider.receiverName = descriptor.receiverName;
    }

    if (descriptor.implicitMemberCalls) {
        provider.implicitMemberCalls = true;
    }

    return provider;
}

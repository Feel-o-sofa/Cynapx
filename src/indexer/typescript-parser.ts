/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as ts from 'typescript';
import * as fs from 'fs';
import { CodeParser, DeltaGraph, RawCodeEdge, TestSpec } from './types';

/** Augments ts.Symbol with the optional `parent` property used internally by the TS compiler */
interface SymbolWithParent extends ts.Symbol {
    parent?: ts.Symbol;
}
import { CodeNode, SymbolType, Visibility } from '../types';
import { MetricsCalculator } from './metrics-calculator';
import { calculateChecksum } from '../utils/checksum';
import { toCanonical } from '../utils/paths';

/** Compiler options shared by every parse — identical to the former per-file ts.createProgram call. */
const PARSER_COMPILER_OPTIONS: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    allowJs: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    lib: ['lib.esnext.d.ts']
};

export class TypeScriptParser implements CodeParser {
    private program: ts.Program | null = null;
    private typeChecker: ts.TypeChecker | null = null;

    // O-4: a single persistent LanguageService reused across every parse() in an
    // indexing run. Previously refreshProgram() called ts.createProgram() fresh
    // per file, which re-read and re-parsed the lib.*.d.ts files (the dominant
    // cost) every time. The LanguageService caches those between calls and only
    // rebuilds the program incrementally when a script version changes. The host
    // exposes exactly the file currently being parsed as the single root script,
    // so getProgram() yields a program with the same source-file set as the old
    // single-root createProgram() — parse/type-check output is unchanged.
    private languageService: ts.LanguageService | null = null;
    // Current root file (the one being parsed); the only entry in getScriptFileNames().
    private currentFile: string | null = null;
    // Per-file script version, bumped whenever a file's on-disk content changes so
    // the LanguageService invalidates and re-parses that file's SourceFile.
    private scriptVersions: Map<string, string> = new Map();
    // Snapshot/content cache keyed by file path for the current root file.
    private scriptSnapshots: Map<string, ts.IScriptSnapshot> = new Map();

    public supports(filePath: string): boolean {
        return filePath.endsWith('.ts') || filePath.endsWith('.js');
    }

    private ensureLanguageService(): ts.LanguageService {
        if (this.languageService) return this.languageService;

        const host: ts.LanguageServiceHost = {
            getScriptFileNames: () => (this.currentFile ? [this.currentFile] : []),
            getScriptVersion: (fileName) => this.scriptVersions.get(fileName) ?? '0',
            getScriptSnapshot: (fileName) => {
                const cached = this.scriptSnapshots.get(fileName);
                if (cached) return cached;
                if (!fs.existsSync(fileName)) return undefined;
                try {
                    const snapshot = ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
                    this.scriptSnapshots.set(fileName, snapshot);
                    return snapshot;
                } catch {
                    return undefined;
                }
            },
            getCurrentDirectory: () => process.cwd(),
            getCompilationSettings: () => PARSER_COMPILER_OPTIONS,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
            directoryExists: ts.sys.directoryExists,
            getDirectories: ts.sys.getDirectories,
        };

        this.languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
        return this.languageService;
    }

    /**
     * O-4: points the persistent LanguageService at `filePath` as its single root
     * script and refreshes the cached Program/TypeChecker. The script version is
     * bumped when the file's content changes (or it is first seen) so the
     * incremental program re-parses only what actually changed.
     */
    private refreshProgram(filePath: string): void {
        const ls = this.ensureLanguageService();
        this.currentFile = filePath;

        // Drop any cached snapshot for this file and re-read it, bumping the
        // version iff the content differs from what the service last parsed.
        this.scriptSnapshots.delete(filePath);
        let content = '';
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch {
            content = '';
        }
        this.scriptSnapshots.set(filePath, ts.ScriptSnapshot.fromString(content));
        const versionKey = `len:${content.length}:hash:${this.cheapHash(content)}`;
        if (this.scriptVersions.get(filePath) !== versionKey) {
            this.scriptVersions.set(filePath, versionKey);
        }

        this.program = ls.getProgram() ?? null;
        this.typeChecker = this.program ? this.program.getTypeChecker() : null;
    }

    /** Small non-cryptographic content hash used only to detect script-version changes. */
    private cheapHash(s: string): string {
        let h = 5381;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(36);
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        this.refreshProgram(filePath);
        const sourceFile = this.program!.getSourceFile(filePath);
        if (!sourceFile) throw new Error(`Source file not found: ${filePath}`);

        const nodes: CodeNode[] = [];
        const edges: RawCodeEdge[] = [];
        const sourceCode = sourceFile.getFullText();
        const canonicalFilePath = toCanonical(filePath);

        // 1. File Node
        const fileNode: CodeNode = {
            qualified_name: canonicalFilePath,
            symbol_type: 'file',
            language: 'typescript',
            file_path: filePath,
            start_line: 1,
            end_line: sourceCode.split('\n').length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            checksum: this.calculateChecksum(sourceCode),
            loc: sourceCode.split('\n').length
        };
        nodes.push(fileNode);

        const visit = (node: ts.Node) => {
            // 2. Define Symbols (Node Extraction)
            if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && (node as ts.NamedDeclaration).name) {
                const symbol = this.typeChecker?.getSymbolAtLocation((node as ts.NamedDeclaration).name!);
                if (symbol) {
                    const qname = toCanonical(this.getName(symbol));
                    const type = this.getSymbolType(node);
                    nodes.push(this.createNode(node, sourceFile, qname, type, filePath, commit, version));

                    // Edge: file -> symbol (defines)
                    edges.push({
                        from_qname: canonicalFilePath,
                        to_qname: qname,
                        edge_type: 'defines',
                        dynamic: false
                    });

                    // Edge: class -> method/property (contains)
                    if (ts.isMethodDeclaration(node) &&
                        (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent))) {
                        const parentClass = node.parent;
                        if (parentClass.name) {
                            const classSymbol = this.typeChecker?.getSymbolAtLocation(parentClass.name);
                            if (classSymbol) {
                                const classQName = toCanonical(this.getName(classSymbol));
                                edges.push({
                                    from_qname: classQName,
                                    to_qname: qname,
                                    edge_type: 'contains',
                                    dynamic: false
                                });
                            }
                        }

                        // Edge: method -> parent method (overrides)
                        const heritageClause = parentClass.heritageClauses?.find(
                            c => c.token === ts.SyntaxKind.ExtendsKeyword
                        );
                        if (heritageClause && heritageClause.types.length > 0) {
                            const methodName = (node.name as ts.Identifier).text;
                            const parentType = this.typeChecker?.getTypeAtLocation(heritageClause.types[0]);
                            const parentPropSymbol = parentType?.getProperty(methodName);
                            if (parentPropSymbol) {
                                const parentDecl = parentPropSymbol.valueDeclaration ?? parentPropSymbol.declarations?.[0];
                                if (parentDecl) {
                                    const parentFile = parentDecl.getSourceFile().fileName;
                                    const parentClassSymbol = parentType?.symbol;
                                    if (parentClassSymbol) {
                                        const parentClassQName = toCanonical(this.getName(parentClassSymbol));
                                        const parentMethodQName = `${parentClassQName}.${methodName}`;
                                        edges.push({
                                            from_qname: qname,
                                            to_qname: parentMethodQName,
                                            edge_type: 'overrides',
                                            dynamic: false,
                                            target_file_hint: parentFile
                                        });
                                    }
                                }
                            }
                        }
                    }

                    // OOP Relationships (inherits / implements)
                    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
                        if (node.heritageClauses) {
                            for (const clause of node.heritageClauses) {
                                const edgeType = clause.token === ts.SyntaxKind.ExtendsKeyword ? 'inherits' : 'implements';
                                for (const typeNode of clause.types) {
                                    const typeSymbol = this.typeChecker?.getSymbolAtLocation(typeNode.expression);
                                    if (typeSymbol) {
                                        edges.push({
                                            from_qname: qname,
                                            to_qname: toCanonical(this.getName(typeSymbol)),
                                            edge_type: edgeType,
                                            dynamic: false
                                        });
                                    } else {
                                        // Fallback to text if symbol cannot be resolved (e.g. external)
                                        edges.push({
                                            from_qname: qname,
                                            to_qname: typeNode.expression.getText(),
                                            edge_type: edgeType,
                                            dynamic: false
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 3. Resolve Imports (Dependency Extraction - Task 4)
            if (ts.isImportDeclaration(node)) {
                const moduleSpecifier = node.moduleSpecifier;
                if (ts.isStringLiteral(moduleSpecifier)) {
                    const pkgName = moduleSpecifier.text;
                    // Only link to external packages (not relative imports)
                    if (!pkgName.startsWith('.')) {
                        const pkgNodeQName = `package:${pkgName}`;
                        edges.push({
                            from_qname: canonicalFilePath,
                            to_qname: pkgNodeQName,
                            edge_type: 'depends_on',
                            dynamic: false
                        });
                    }
                }
            }

            // 4. Resolve Calls (Edge Extraction)
            if (ts.isCallExpression(node)) {
                const centerNode = this.findParentSymbol(node);
                const fromQName = centerNode ? toCanonical(this.getName(centerNode)) : canonicalFilePath;

                // Detect `something.method.bind(this)` pattern.
                // The outer call is to Function.prototype.bind; the actual callee is
                // the property access expression that precedes `.bind`.  We resolve
                // that inner expression instead so a proper `calls` edge is emitted.
                if (
                    ts.isPropertyAccessExpression(node.expression) &&
                    node.expression.name.text === 'bind' &&
                    ts.isPropertyAccessExpression(node.expression.expression)
                ) {
                    const actualCallee = node.expression.expression;
                    const symbol = this.typeChecker?.getSymbolAtLocation(actualCallee);
                    if (symbol) {
                        const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
                        if (declaration) {
                            edges.push({
                                from_qname: fromQName,
                                to_qname: toCanonical(this.getName(symbol)),
                                edge_type: 'calls',
                                dynamic: false,
                                call_site_line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                                target_file_hint: declaration.getSourceFile().fileName
                            });
                        }
                    }
                } else {
                    this.resolveCall(node, sourceFile, fromQName, edges);
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        const testSpecs: TestSpec[] = [];
        if (this.isTestFile(filePath)) {
            this.emitTestEdges(sourceFile, filePath, canonicalFilePath, edges, testSpecs);
        }

        return { nodes, edges, testSpecs };
    }

    private isTestFile(filePath: string): boolean {
        // Match *.test.ts, *.test.js, *.spec.ts, *.spec.js and tsx/jsx variants
        if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(filePath)) {
            return true;
        }
        // Match paths containing /__tests__/ or \__tests__\
        if (filePath.includes('/__tests__/') || filePath.includes('\\__tests__\\')) {
            return true;
        }
        return false;
    }

    private inferProductionFilePath(testFilePath: string): string | null {
        // foo.test.ts → foo.ts, foo.spec.tsx → foo.tsx, etc.
        const testSpecMatch = testFilePath.match(/^(.*)\.(test|spec)\.(ts|js|tsx|jsx)$/);
        if (testSpecMatch) {
            return `${testSpecMatch[1]}.${testSpecMatch[3]}`;
        }
        // path/__tests__/foo.ts → path/foo.ts
        const testsDir = testFilePath.replace('/__tests__/', '/').replace('\\__tests__\\', '\\');
        if (testsDir !== testFilePath) {
            return testsDir;
        }
        return null;
    }

    /**
     * Given a candidate path that may not exist (e.g. "tests/checksum.ts"),
     * resolve the actual production file path by:
     *   1. Using the candidate directly if it exists on disk.
     *   2. Searching src/, lib/, source/, app/ under the project root for a
     *      file whose basename matches the candidate's basename.
     * Returns null if no file can be found.
     */
    private resolveProductionFile(candidatePath: string, testFilePath: string): string | null {
        // Fast path: file already exists at the candidate location
        if (fs.existsSync(candidatePath)) return candidatePath;

        const path = require('path') as typeof import('path');
        const basename = path.basename(candidatePath); // e.g. "checksum.ts"
        const ext = path.extname(basename);             // e.g. ".ts"
        const stem = path.basename(basename, ext);      // e.g. "checksum"
        const projectRoot = this.findProjectRoot(testFilePath);
        if (!projectRoot) return null;

        const searchDirs = ['src', 'lib', 'source', 'app'];

        // Slow path 1: exact basename match (e.g. checksum.ts → src/utils/checksum.ts)
        for (const dir of searchDirs) {
            const found = this.walkForFile(path.join(projectRoot, dir), basename);
            if (found) return found;
        }

        // P10-M-4 — Slow path 2: fuzzy stem match
        // Handles cases where test basename differs from production basename.
        // e.g. "tests/parser.test.ts" → candidate "tests/parser.ts" (stem="parser")
        // but actual file is "src/indexer/typescript-parser.ts" (contains "parser").
        // We search for any file whose name (without extension) contains the stem.
        for (const dir of searchDirs) {
            const found = this.walkForFileFuzzy(path.join(projectRoot, dir), stem, ext);
            if (found) return found;
        }
        return null;
    }

    /**
     * P10-M-4: Walk a directory tree looking for a file whose name (without extension)
     * contains `stem` and whose extension matches `ext`.
     * Returns the first match found (depth-first), or null.
     */
    private walkForFileFuzzy(dir: string, stem: string, ext: string): string | null {
        if (!fs.existsSync(dir)) return null;
        try {
            const path = require('path') as typeof import('path');
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            // Files before subdirectories so shallower matches win
            const files = entries.filter(e => !e.isDirectory());
            const dirs  = entries.filter(e => e.isDirectory());
            for (const entry of files) {
                if (path.extname(entry.name) === ext && path.basename(entry.name, ext).includes(stem)) {
                    return path.join(dir, entry.name);
                }
            }
            for (const entry of dirs) {
                const result = this.walkForFileFuzzy(path.join(dir, entry.name), stem, ext);
                if (result) return result;
            }
        } catch { /* ignore permission errors */ }
        return null;
    }

    /** Walk upward from filePath to find the nearest directory containing package.json */
    private findProjectRoot(filePath: string): string | null {
        const path = require('path') as typeof import('path');
        let dir = path.dirname(filePath);
        for (let i = 0; i < 8; i++) {
            if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        return null;
    }

    private walkForFile(dir: string, basename: string): string | null {
        if (!fs.existsSync(dir)) return null;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = require('path').join(dir, entry.name);
                if (entry.isDirectory()) {
                    const result = this.walkForFile(fullPath, basename);
                    if (result) return result;
                } else if (entry.name === basename) {
                    return fullPath;
                }
            }
        } catch { /* ignore permission errors */ }
        return null;
    }

    private emitTestEdges(sourceFile: ts.SourceFile, testFilePath: string, testFileQname: string, edges: RawCodeEdge[], testSpecs: TestSpec[]): void {
        const candidatePath = this.inferProductionFilePath(testFilePath);
        if (candidatePath === null) return;

        // Resolve to an actual file that exists on disk; skip if not found
        const prodFilePath = this.resolveProductionFile(candidatePath, testFilePath);
        if (prodFilePath === null) return;

        const prodFileQname = toCanonical(prodFilePath);

        // Always emit a file-level tests edge
        edges.push({
            from_qname: testFileQname,
            to_qname: prodFileQname,
            edge_type: 'tests',
            dynamic: false
        });

        // Walk AST looking for describe(...) calls
        const walkForDescribe = (node: ts.Node) => {
            if (
                ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                node.expression.text === 'describe' &&
                node.arguments.length > 0 &&
                ts.isStringLiteral(node.arguments[0])
            ) {
                const describeName = (node.arguments[0] as ts.StringLiteral).text;

                // Always emit edge for the full describe string
                edges.push({
                    from_qname: testFileQname,
                    to_qname: `${prodFileQname}#${describeName}`,
                    edge_type: 'tests',
                    dynamic: false,
                    target_file_hint: prodFilePath
                });

                // P10-M-2: If the describe name contains extra context after the
                // leading PascalCase identifier (e.g. "TypeScriptParser — edge detection"),
                // also emit a precise edge using only the leading identifier so that
                // get_related_tests can match the actual class/function symbol node.
                const leadingIdent = describeName.match(/^([A-Z][a-zA-Z0-9]+)/)?.[1];
                if (leadingIdent && leadingIdent !== describeName) {
                    edges.push({
                        from_qname: testFileQname,
                        to_qname: `${prodFileQname}#${leadingIdent}`,
                        edge_type: 'tests',
                        dynamic: false,
                        target_file_hint: prodFilePath
                    });
                }
            }
            ts.forEachChild(node, walkForDescribe);
        };

        walkForDescribe(sourceFile);

        // P7: Second pass — capture individual it()/test() specs, their assertions,
        // and the target symbol resolved from the enclosing describe() block name.
        const walkForSpecs = (node: ts.Node, describeTarget: string | undefined) => {
            let currentTarget = describeTarget;

            // Track enclosing describe() so nested it()/test() resolve to the right symbol.
            if (
                ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                node.expression.text === 'describe' &&
                node.arguments.length > 0 &&
                ts.isStringLiteral(node.arguments[0])
            ) {
                const describeName = (node.arguments[0] as ts.StringLiteral).text;
                // Use the leading PascalCase identifier as the precise symbol name,
                // mirroring the matching logic in walkForDescribe.
                const leadingIdent = describeName.match(/^([A-Z][a-zA-Z0-9]+)/)?.[1] ?? describeName;
                currentTarget = `${prodFileQname}#${leadingIdent}`;
            }

            // Detect it(...) / test(...) including it.each(...)/test.each(...) forms.
            const spec = this.extractSpecCall(node);
            if (spec) {
                const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                const assertions: string[] = [];
                this.collectAssertions(node, assertions);
                testSpecs.push({
                    testQname: testFileQname,
                    title: spec.title,
                    targetQname: currentTarget,
                    assertions,
                    filePath: testFilePath,
                    startLine
                });
            }

            ts.forEachChild(node, child => walkForSpecs(child, currentTarget));
        };

        walkForSpecs(sourceFile, undefined);
    }

    /**
     * P7: Recognizes an it()/test() call (and it.each()/test.each() variants) and
     * extracts the title string from the first argument. Returns null otherwise.
     */
    private extractSpecCall(node: ts.Node): { title: string } | null {
        if (!ts.isCallExpression(node)) return null;
        const expr = node.expression;

        let isSpec = false;
        if (ts.isIdentifier(expr) && (expr.text === 'it' || expr.text === 'test')) {
            isSpec = true;
        } else if (
            // it.each(...)(...) / test.each(...)(...) — the outer call's expression
            // is itself a call to it.each / test.each.
            ts.isCallExpression(expr) &&
            ts.isPropertyAccessExpression(expr.expression) &&
            ts.isIdentifier(expr.expression.expression) &&
            (expr.expression.expression.text === 'it' || expr.expression.expression.text === 'test') &&
            expr.expression.name.text === 'each'
        ) {
            isSpec = true;
        } else if (
            // it.only(...) / it.skip(...) / test.only(...) etc.
            ts.isPropertyAccessExpression(expr) &&
            ts.isIdentifier(expr.expression) &&
            (expr.expression.text === 'it' || expr.expression.text === 'test') &&
            (expr.name.text === 'only' || expr.name.text === 'skip')
        ) {
            isSpec = true;
        }

        if (!isSpec || node.arguments.length === 0) return null;
        const titleArg = node.arguments[0];
        if (!ts.isStringLiteralLike(titleArg)) return null;
        return { title: titleArg.text };
    }

    /**
     * P7: Walks a node subtree collecting normalized expect(...).<matcher>(...)
     * assertion strings. Skips nested it()/test() bodies so each spec only owns
     * its own assertions.
     */
    private collectAssertions(specNode: ts.Node, out: string[]): void {
        const walk = (node: ts.Node) => {
            // Don't descend into nested it()/test() calls — those own their assertions.
            if (node !== specNode && this.extractSpecCall(node)) return;

            if (ts.isCallExpression(node)) {
                const normalized = this.normalizeAssertion(node);
                if (normalized) out.push(normalized);
            }
            ts.forEachChild(node, walk);
        };
        ts.forEachChild(specNode, walk);
    }

    /**
     * P7: Normalizes an expect(subject).<...>.matcher(arg) call expression into a
     * compact string like "expect(result).toBe(42)" or "expect(fn).not.toThrow()".
     * Returns null if the call is not a recognizable expect() chain.
     */
    private normalizeAssertion(node: ts.CallExpression): string | null {
        const TRUNC = 80;
        const truncate = (s: string): string => {
            const compact = s.replace(/\s+/g, ' ').trim();
            return compact.length > TRUNC ? compact.slice(0, TRUNC) + '…' : compact;
        };

        // The matcher call's expression must be a property access whose chain
        // bottoms out at an expect(...) call.
        if (!ts.isPropertyAccessExpression(node.expression)) return null;
        const matcherName = node.expression.name.text;

        // Walk the property-access chain inward, collecting modifier prefixes
        // (e.g. .not, .resolves, .rejects) until we hit the expect(...) call.
        const modifiers: string[] = [];
        let chain: ts.Expression = node.expression.expression;
        while (ts.isPropertyAccessExpression(chain)) {
            modifiers.unshift(chain.name.text);
            chain = chain.expression;
        }

        if (
            !ts.isCallExpression(chain) ||
            !ts.isIdentifier(chain.expression) ||
            chain.expression.text !== 'expect'
        ) {
            return null;
        }

        // Subject is the first argument to expect(...).
        const subject = chain.arguments.length > 0 ? truncate(chain.arguments[0].getText()) : '';

        // First argument to the matcher (if any).
        const arg = node.arguments.length > 0 ? truncate(node.arguments[0].getText()) : '';

        const modifierPrefix = modifiers.length > 0 ? '.' + modifiers.join('.') : '';
        return `expect(${subject})${modifierPrefix}.${matcherName}(${arg})`;
    }

    private getName(symbol: ts.Symbol): string {
        const parts: string[] = [];
        let current: ts.Symbol | undefined = symbol;
        while (current && current.getName() !== '__export' && current.getName() !== 'default' && !(current.flags & ts.SymbolFlags.Module)) {
            parts.unshift(current.getName());
            current = (current as SymbolWithParent).parent;
        }

        const decl = symbol.valueDeclaration || symbol.declarations?.[0];
        const fileName = decl?.getSourceFile().fileName || '';
        return `${fileName}#${parts.join('.')}`;
    }

    private findParentSymbol(node: ts.Node): ts.Symbol | undefined {
        let parent = node.parent;
        while (parent && !ts.isClassDeclaration(parent) && !ts.isMethodDeclaration(parent) && !ts.isFunctionDeclaration(parent)) {
            parent = parent.parent;
        }
        if (parent && 'name' in parent && (parent as ts.NamedDeclaration).name) {
            return this.typeChecker?.getSymbolAtLocation((parent as ts.NamedDeclaration).name!);
        }
        return undefined;
    }

    private getSymbolType(node: ts.Node): SymbolType {
        if (ts.isClassDeclaration(node)) return 'class';
        if (ts.isInterfaceDeclaration(node)) return 'interface';
        if (ts.isMethodDeclaration(node)) return 'method';
        if (ts.isFunctionDeclaration(node)) return 'function';
        return 'field';
    }

    private resolveCall(node: ts.CallExpression, sourceFile: ts.SourceFile, fromQName: string, edges: RawCodeEdge[]) {
        const symbol = this.typeChecker?.getSymbolAtLocation(node.expression);
        if (symbol) {
            const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
            if (declaration) {
                const targetFile = declaration.getSourceFile().fileName;
                const targetQName = toCanonical(this.getName(symbol));

                edges.push({
                    from_qname: fromQName,
                    to_qname: targetQName,
                    edge_type: 'calls',
                    dynamic: false,
                    call_site_line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                    target_file_hint: targetFile
                });
            }
        }
    }

    private createNode(
        node: ts.Node,
        sourceFile: ts.SourceFile,
        qname: string,
        type: SymbolType,
        filePath: string,
        commit: string,
        version: number
    ): CodeNode {
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        let signature: string | undefined;
        let returnType: string | undefined;
        let fieldType: string | undefined;
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node)?.map(m => m.getText()) : undefined;

        if (this.typeChecker) {
            if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isMethodSignature(node)) {
                const nameNode = (node as ts.NamedDeclaration).name;
                if (nameNode) {
                    const tsSymbol = this.typeChecker.getSymbolAtLocation(nameNode);
                    if (tsSymbol) {
                        const tsType = this.typeChecker.getTypeOfSymbolAtLocation(tsSymbol, nameNode);
                        const signatures = tsType.getCallSignatures();
                        if (signatures.length > 0) {
                            signature = this.typeChecker.signatureToString(signatures[0]);
                            returnType = this.typeChecker.typeToString(signatures[0].getReturnType());
                        }
                    }
                }
            } else if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isVariableDeclaration(node)) {
                const tsType = this.typeChecker.getTypeAtLocation(node);
                fieldType = this.typeChecker.typeToString(tsType);
            }
        }

        const docstring = this.extractDocstring(node, sourceFile);

        return {
            qualified_name: qname,
            symbol_type: type,
            language: 'typescript',
            file_path: filePath,
            start_line: startLine + 1,
            end_line: endLine + 1,
            visibility: this.getVisibility(node),
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            loc: endLine - startLine + 1,
            cyclomatic: MetricsCalculator.calculateCyclomaticComplexity(node),
            signature,
            return_type: returnType,
            field_type: fieldType,
            modifiers,
            docstring
        };
    }

    /**
     * Extracts the leading JSDoc comment or line-comment block for a node, if any.
     * Captured as "intent" for the knowledge base (P1).
     */
    private extractDocstring(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
        // Try TypeScript JSDoc first
        const jsdocComments = ts.getJSDocCommentsAndTags(node) as ts.JSDoc[];
        if (jsdocComments.length > 0) {
            const jsdoc = jsdocComments[0];
            if (ts.isJSDoc(jsdoc) && jsdoc.comment) {
                const comment = typeof jsdoc.comment === 'string'
                    ? jsdoc.comment
                    : jsdoc.comment.map((n: ts.Node) => n.getText(sourceFile)).join('');
                if (comment.trim()) return comment.trim();
            }
            // Fallback: get the raw JSDoc text
            const raw = jsdoc.getText(sourceFile).replace(/^\/\*\*|\*\/$|^\s*\*\s?/gm, '').trim();
            if (raw) return raw;
        }

        // Fall back to leading line comments
        const fullStart = node.getFullStart();
        const nodeStart = node.getStart(sourceFile);
        const leadingText = sourceFile.getFullText().slice(fullStart, nodeStart);
        const lineComments = leadingText.match(/\/\/[^\n]*/g);
        if (lineComments) {
            const text = lineComments.map(l => l.replace(/^\/\/\s?/, '').trim()).filter(Boolean).join('\n');
            if (text) return text;
        }

        return undefined;
    }

    private getVisibility(node: ts.Node): Visibility {
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        if (modifiers) {
            if (modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
            if (modifiers.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
        }
        return 'public';
    }

    private calculateChecksum(content: string): string {
        return calculateChecksum(content);
    }
}


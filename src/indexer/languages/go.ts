/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
import { LanguageDescriptor } from './descriptor';
import { TestSpec } from '../types';
import { directChildrenOfType, inferProdFilePath, truncate } from './test-spec-helpers';
import { toCanonical } from '../../utils/paths';

/**
 * go.mod lookup cache: directory → { modulePath, moduleDir } of the nearest
 * enclosing module, or null when no go.mod exists up the tree. Module paths
 * change essentially never during a process lifetime, so a plain Map is fine
 * (same lifetime model as the lazily cached grammar modules).
 */
const goModuleCache = new Map<string, { modulePath: string; moduleDir: string } | null>();

/** Package directory listing cache: dir → non-test .go files (or null when unreadable). */
const goPackageFilesCache = new Map<string, string[] | null>();

/** Walk up from `dir` to find the nearest go.mod and read its module path. */
function findGoModule(dir: string): { modulePath: string; moduleDir: string } | null {
    const cached = goModuleCache.get(dir);
    if (cached !== undefined) return cached;

    let result: { modulePath: string; moduleDir: string } | null = null;
    const goModPath = path.join(dir, 'go.mod');
    try {
        if (fs.existsSync(goModPath)) {
            const content = fs.readFileSync(goModPath, 'utf8');
            const match = content.match(/^\s*module\s+(\S+)/m);
            if (match) result = { modulePath: match[1], moduleDir: dir };
        }
    } catch {
        // Unreadable go.mod: treat as absent.
    }
    if (!result) {
        const parent = path.dirname(dir);
        result = parent === dir ? null : findGoModule(parent);
    }
    goModuleCache.set(dir, result);
    return result;
}

/** List the non-test .go files of a package directory (empty when none/unreadable). */
function listGoPackageFiles(pkgDir: string): string[] {
    const cached = goPackageFilesCache.get(pkgDir);
    if (cached !== undefined) return cached ?? [];

    let files: string[] | null = null;
    try {
        files = fs.readdirSync(pkgDir)
            .filter(f => f.endsWith('.go') && !f.endsWith('_test.go'))
            .map(f => path.join(pkgDir, f));
    } catch {
        files = null;
    }
    goPackageFilesCache.set(pkgDir, files);
    return files ?? [];
}

/** Test hook: clear the go.mod / package-listing caches (fixtures reuse temp dirs). */
export function clearGoModuleCaches(): void {
    goModuleCache.clear();
    goPackageFilesCache.clear();
}

/** True if the function has a `*testing.T` (or `*testing.B`) parameter. */
function hasTestingParam(fn: Parser.SyntaxNode): boolean {
    const params = fn.childForFieldName('parameters');
    if (!params) return false;
    return params.text.includes('testing.T') || params.text.includes('testing.B');
}

/**
 * Collect assertion-like statements from a Go test function body:
 *  - t.Error* / t.Fatal* calls
 *  - testify assert.* / require.* calls
 *  - `if <comparison>` guard conditions
 * Does not descend into nested t.Run func literals (those become sub-specs).
 */
function collectGoAssertions(fn: Parser.SyntaxNode, body: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    for (const call of body.descendantsOfType('call_expression')) {
        const callee = call.childForFieldName('function');
        if (!callee || callee.type !== 'selector_expression') continue;
        const text = callee.text.replace(/\s+/g, '');
        if (/^[A-Za-z_][\w]*\.(Error|Fatal)/.test(text) ||
            /^(assert|require)\./.test(text)) {
            out.push(truncate(call.text));
        }
    }
    for (const ifStmt of body.descendantsOfType('if_statement')) {
        const cond = ifStmt.childForFieldName('condition');
        if (cond && cond.type === 'binary_expression') {
            const op = cond.childForFieldName('operator')?.text ?? '';
            if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
                out.push(truncate(`if ${cond.text}`));
            }
        }
    }
    return out;
}

/** Extract t.Run("name", ...) subtest string literals within a test body. */
function collectGoSubtests(body: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    for (const call of body.descendantsOfType('call_expression')) {
        const callee = call.childForFieldName('function');
        if (!callee || callee.type !== 'selector_expression') continue;
        if (callee.childForFieldName('field')?.text !== 'Run') continue;
        const args = call.childForFieldName('arguments');
        const firstArg = args?.namedChildren[0];
        if (firstArg && firstArg.type === 'interpreted_string_literal') {
            out.push(firstArg.text.replace(/^"|"$/g, ''));
        }
    }
    return out;
}

export const goDescriptor: LanguageDescriptor = {
    name: 'go',
    extensions: ['go'],
    grammarModule: 'tree-sitter-go',
    queryFile: 'go.scm',
    captureMap: [
        ['class', 'class'],
        ['function', 'function'],
        ['method', 'method']
    ],
    defaultSymbolType: 'field',
    decisionPoints: ['if_statement', 'for_statement', 'expression_case', 'type_case', 'communication_case', 'binary_expression'],
    normalizeDocstring(raw: string): string {
        return raw.replace(/^\s*\/\/\s?/gm, '').trim();
    },
    resolveImport(node, fromQName, edges, _captureName, absFilePath) {
        const pathNode = node.descendantsOfType('interpreted_string_literal')[0];
        if (!pathNode) return;
        const pkgPath = pathNode.text.replace(/"/g, '');

        // Local module import: when the import path lives under the nearest
        // go.mod's module path, resolve it to the package's .go files so the
        // graph gets real file-to-file edges. Candidates that are not indexed
        // are dropped harmlessly by the update pipeline (same contract as the
        // Python/Rust local-import resolution, P8-3).
        if (absFilePath) {
            const mod = findGoModule(path.dirname(absFilePath));
            if (mod && (pkgPath === mod.modulePath || pkgPath.startsWith(mod.modulePath + '/'))) {
                const rel = pkgPath === mod.modulePath ? '' : pkgPath.slice(mod.modulePath.length + 1);
                const pkgDir = path.join(mod.moduleDir, rel);
                const files = listGoPackageFiles(pkgDir);
                for (const file of files) {
                    edges.push({
                        from_qname: fromQName,
                        to_qname: toCanonical(file),
                        edge_type: 'depends_on',
                        dynamic: false
                    });
                }
                if (files.length > 0) return;
            }
        }

        // External (or unresolvable local) package import.
        edges.push({
            from_qname: fromQName,
            to_qname: `package:${pkgPath}`,
            edge_type: 'depends_on',
            dynamic: false
        });
    },
    extractTestSpecs(root, filePath, fileQname): TestSpec[] {
        const specs: TestSpec[] = [];
        // `foo_test.go` exercises the sibling `foo.go`; `TestAdd` targets its
        // `Add` symbol (canonical qnames are lowercase). Best-effort: a target
        // that resolves to nothing simply never matches a lookup.
        const prodFile = inferProdFilePath(filePath);
        for (const fn of directChildrenOfType(root, 'function_declaration')) {
            const name = fn.childForFieldName('name')?.text;
            if (!name || !name.startsWith('Test') || !hasTestingParam(fn)) continue;
            const body = fn.childForFieldName('body');
            if (!body) continue;

            const symbol = name.length > 'Test'.length ? name.slice('Test'.length).toLowerCase() : undefined;
            const targetQname = prodFile ? (symbol ? `${prodFile}#${symbol}` : prodFile) : undefined;

            specs.push({
                testQname: `${fileQname}#${name}`,
                title: name,
                targetQname,
                assertions: collectGoAssertions(fn, body),
                filePath,
                startLine: fn.startPosition.row + 1
            });

            for (const sub of collectGoSubtests(body)) {
                specs.push({
                    testQname: `${fileQname}#${name}/${sub}`,
                    title: `${name}/${sub}`,
                    targetQname,
                    assertions: [],
                    filePath,
                    startLine: fn.startPosition.row + 1
                });
            }
        }
        return specs;
    }
};

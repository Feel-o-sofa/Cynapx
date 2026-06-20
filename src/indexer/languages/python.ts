/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import * as path from 'path';
import { LanguageDescriptor } from './descriptor';
import { RawCodeEdge, TestSpec } from '../types';
import { directChildrenOfType, truncate } from './test-spec-helpers';
import { toCanonical } from '../../utils/paths';

/** Returns the test function's name if it looks like a pytest/unittest test. */
function pyFuncName(fn: Parser.SyntaxNode): string | undefined {
    const nameNode = fn.childForFieldName('name');
    return nameNode?.text;
}

/** True for a class that holds unittest-style tests (Test*, *Test, *TestCase). */
function isUnittestClass(name: string): boolean {
    return name.startsWith('Test') || name.endsWith('Test') || name.endsWith('TestCase');
}

/** Collect `assert <expr>` statements within a function body as strings. */
function collectPyAsserts(fn: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    for (const stmt of fn.descendantsOfType('assert_statement')) {
        out.push(truncate(stmt.text));
    }
    // unittest: self.assert*(...) calls
    for (const call of fn.descendantsOfType('call')) {
        const fnField = call.childForFieldName('function');
        if (fnField && fnField.text.replace(/\s+/g, '').startsWith('self.assert')) {
            out.push(truncate(call.text));
        }
    }
    return out;
}

/**
 * Resolve a Python relative import (`from . import x`, `from .utils import y`,
 * `from ..pkg import z`) to the canonical path(s) of the local target file(s)
 * and emit best-effort `depends_on` edges. Unresolved edges (targets outside
 * the project) drop harmlessly downstream, so emitting `.py` and package
 * `__init__.py` candidates is safe.
 *
 * Dot semantics: N leading dots = N directory levels. 1 dot = the importing
 * file's directory, 2 dots = its parent, so the base dir is the file dir gone
 * up (N - 1) levels.
 */
function resolvePyRelativeImport(
    stmt: Parser.SyntaxNode,
    relativeImport: Parser.SyntaxNode,
    fromQName: string,
    edges: RawCodeEdge[],
    absFilePath?: string
): void {
    if (!absFilePath) return;

    const prefixNode = relativeImport.descendantsOfType('import_prefix')[0];
    const dotCount = prefixNode ? (prefixNode.text.match(/\./g)?.length ?? 0) : 0;
    if (dotCount === 0) return;

    // Base directory: file's dir, then up (dotCount - 1) levels.
    let baseDir = path.dirname(absFilePath);
    for (let i = 0; i < dotCount - 1; i++) {
        baseDir = path.dirname(baseDir);
    }

    const emitModule = (segments: string[]): void => {
        if (segments.length === 0) return;
        const targetBase = path.join(baseDir, ...segments);
        const candidates = [`${targetBase}.py`, path.join(targetBase, '__init__.py')];
        for (const candidate of candidates) {
            edges.push({ from_qname: fromQName, to_qname: toCanonical(candidate), edge_type: 'depends_on', dynamic: false });
        }
    };

    const moduleDottedName = relativeImport.descendantsOfType('dotted_name')[0];
    if (moduleDottedName) {
        // `from .utils import x` / `from ..pkg.sub import y`
        emitModule(moduleDottedName.text.split('.'));
    } else {
        // `from . import z, w` — each imported name is a sibling module.
        for (let i = 0; i < stmt.childCount; i++) {
            const child = stmt.child(i)!;
            if (child.type === 'dotted_name' && stmt.fieldNameForChild(i) === 'name') {
                emitModule(child.text.split('.'));
            }
        }
    }
}

export const pythonDescriptor: LanguageDescriptor = {
    name: 'python',
    extensions: ['py'],
    grammarModule: 'tree-sitter-python',
    queryFile: 'python.scm',
    captureMap: [
        ['class', 'class'],
        ['function', 'function'],
        ['method', 'method']
    ],
    defaultSymbolType: 'field',
    decisionPoints: [
        'if_statement', 'elif_clause', 'for_statement', 'while_statement',
        'case_clause', 'except_clause', 'conditional_expression', 'boolean_operator'
    ],
    resolveImport(node, fromQName, edges, captureName, absFilePath) {
        if (captureName === 'relation.inherits') {
            edges.push({ from_qname: fromQName, to_qname: node.text, edge_type: 'inherits', dynamic: false });
            return;
        }

        if (node.type === 'import_statement') {
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i)!;
                if (child.type === 'aliased_import') {
                    const nameNode = child.childForFieldName('name');
                    if (nameNode) {
                        const pkgName = nameNode.text.split('.')[0];
                        edges.push({ from_qname: fromQName, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false });
                    }
                } else if (child.type === 'dotted_name') {
                    const pkgName = child.text.split('.')[0];
                    edges.push({ from_qname: fromQName, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false });
                }
            }
        } else if (node.type === 'import_from_statement') {
            const moduleNode = node.childForFieldName('module_name');
            if (!moduleNode) return;

            if (moduleNode.type === 'relative_import') {
                // Local/relative import: resolve to a sibling/ancestor .py file.
                resolvePyRelativeImport(node, moduleNode, fromQName, edges, absFilePath);
            } else {
                const pkgName = moduleNode.text.split('.')[0];
                edges.push({ from_qname: fromQName, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false });
            }
        }
    },
    extractTestSpecs(root, filePath, fileQname): TestSpec[] {
        const specs: TestSpec[] = [];

        const addSpec = (fn: Parser.SyntaxNode, name: string, qnameKey: string): void => {
            specs.push({
                testQname: `${fileQname}#${qnameKey}`,
                title: name,
                targetQname: undefined,
                assertions: collectPyAsserts(fn),
                filePath,
                startLine: fn.startPosition.row + 1
            });
        };

        // pytest: top-level `def test_*`
        for (const fn of directChildrenOfType(root, 'function_definition')) {
            const name = pyFuncName(fn);
            if (name && name.startsWith('test_')) addSpec(fn, name, name);
        }

        // unittest: `def test_*` methods inside Test* / *TestCase classes
        for (const cls of directChildrenOfType(root, 'class_definition')) {
            const className = cls.childForFieldName('name')?.text ?? '';
            if (!isUnittestClass(className)) continue;
            const body = cls.childForFieldName('body');
            if (!body) continue;
            for (const fn of directChildrenOfType(body, 'function_definition')) {
                const name = pyFuncName(fn);
                if (name && name.startsWith('test_')) addSpec(fn, name, `${className}.${name}`);
            }
        }

        return specs;
    }
};

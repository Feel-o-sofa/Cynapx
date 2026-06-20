/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { LanguageDescriptor } from './descriptor';
import { TestSpec } from '../types';
import { directChildrenOfType, truncate } from './test-spec-helpers';

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
    resolveImport(node, fromQName, edges, captureName) {
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
            if (moduleNode) {
                const pkgName = moduleNode.text.split('.')[0];
                let isRelative = false;
                for (let i = 0; i < node.childCount; i++) {
                    if (node.child(i)!.type === 'relative_import' || node.child(i)!.text.startsWith('.')) {
                        isRelative = true;
                        break;
                    }
                }
                if (!isRelative) {
                    edges.push({ from_qname: fromQName, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false });
                }
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

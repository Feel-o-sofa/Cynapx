/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { LanguageDescriptor } from './descriptor';
import { TestSpec } from '../types';
import { truncate } from './test-spec-helpers';

/** True if the enclosing class looks like a PHPUnit test class (`FooTest` / extends TestCase). */
function isTestClass(cls: Parser.SyntaxNode): boolean {
    const name = cls.childForFieldName('name')?.text ?? '';
    if (/Test$/.test(name)) return true;
    const base = cls.namedChildren.find(c => c.type === 'base_clause');
    return base ? /TestCase/.test(base.text) : false;
}

/** True if a method_declaration is a PHPUnit test: `test*` name or `#[Test]` attribute. */
function isTestMethod(method: Parser.SyntaxNode): boolean {
    const name = method.childForFieldName('name')?.text ?? '';
    if (name.startsWith('test')) return true;
    for (const attr of method.descendantsOfType('attribute')) {
        if (/(^|\\)Test$/.test(attr.text.replace(/^#\[|\]$/g, '').trim())) return true;
    }
    return false;
}

/** Collect $this->assert* / self::assert* / assert*() calls within a method body. */
function collectPhpAsserts(method: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    for (const callType of ['member_call_expression', 'scoped_call_expression', 'function_call_expression']) {
        for (const call of method.descendantsOfType(callType)) {
            const name = call.childForFieldName('name')?.text ?? '';
            if (name.startsWith('assert') || name.startsWith('expect')) {
                out.push(truncate(call.text));
            }
        }
    }
    return out;
}

export const phpDescriptor: LanguageDescriptor = {
    name: 'php',
    extensions: ['php'],
    grammarModule: 'tree-sitter-php',
    grammarExport: 'php',
    queryFile: 'php.scm',
    captureMap: [
        ['class', 'class'],
        ['interface', 'interface'],
        ['method', 'method']
    ],
    defaultSymbolType: 'function',
    decisionPoints: ['if_statement', 'for_statement', 'foreach_statement', 'while_statement', 'catch_clause'],
    normalizeDocstring(raw: string): string {
        // PHPDoc block (/** ... */), plain block, // or # line comments.
        return raw
            .replace(/^\/\*\*?/, '')
            .replace(/\*\/\s*$/, '')
            .replace(/^\s*\*\s?/gm, '')
            .replace(/^\s*(?:\/\/|#)\s?/gm, '')
            .trim();
    },
    resolveImport(node, fromQName, edges, captureName) {
        if (captureName?.startsWith('relation')) {
            edges.push({
                from_qname: fromQName,
                to_qname: node.text,
                edge_type: captureName.endsWith('inherits') ? 'inherits' : 'implements',
                dynamic: false
            });
        }
    },
    extractTestSpecs(root, filePath, fileQname): TestSpec[] {
        const specs: TestSpec[] = [];
        for (const cls of root.descendantsOfType('class_declaration')) {
            if (!isTestClass(cls)) continue;
            for (const method of cls.descendantsOfType('method_declaration')) {
                if (!isTestMethod(method)) continue;
                const name = method.childForFieldName('name')?.text;
                if (!name) continue;
                specs.push({
                    testQname: `${fileQname}#${name}`,
                    title: name,
                    targetQname: undefined,
                    assertions: collectPhpAsserts(method),
                    filePath,
                    startLine: method.startPosition.row + 1
                });
            }
        }
        return specs;
    }
};

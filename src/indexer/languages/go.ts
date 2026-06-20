/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { LanguageDescriptor } from './descriptor';
import { TestSpec } from '../types';
import { directChildrenOfType, truncate } from './test-spec-helpers';

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
    resolveImport(node, fromQName, edges) {
        const pathNode = node.descendantsOfType('interpreted_string_literal')[0];
        if (pathNode) {
            const pkgPath = pathNode.text.replace(/"/g, '');
            edges.push({
                from_qname: fromQName,
                to_qname: `package:${pkgPath}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    },
    extractTestSpecs(root, filePath, fileQname): TestSpec[] {
        const specs: TestSpec[] = [];
        for (const fn of directChildrenOfType(root, 'function_declaration')) {
            const name = fn.childForFieldName('name')?.text;
            if (!name || !name.startsWith('Test') || !hasTestingParam(fn)) continue;
            const body = fn.childForFieldName('body');
            if (!body) continue;

            specs.push({
                testQname: `${fileQname}#${name}`,
                title: name,
                targetQname: undefined,
                assertions: collectGoAssertions(fn, body),
                filePath,
                startLine: fn.startPosition.row + 1
            });

            for (const sub of collectGoSubtests(body)) {
                specs.push({
                    testQname: `${fileQname}#${name}/${sub}`,
                    title: `${name}/${sub}`,
                    targetQname: undefined,
                    assertions: [],
                    filePath,
                    startLine: fn.startPosition.row + 1
                });
            }
        }
        return specs;
    }
};

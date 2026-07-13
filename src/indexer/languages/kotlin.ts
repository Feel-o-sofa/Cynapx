/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { LanguageDescriptor } from './descriptor';
import { TestSpec } from '../types';
import { truncate } from './test-spec-helpers';

/** True if a function_declaration carries a `@Test` annotation (JUnit / kotlin.test). */
function hasTestAnnotation(fn: Parser.SyntaxNode): boolean {
    const modifiers = fn.namedChildren.find(c => c.type === 'modifiers');
    if (!modifiers) return false;
    for (const ann of modifiers.descendantsOfType('annotation')) {
        // Matches @Test and qualified forms like @org.junit.jupiter.api.Test.
        if (/(^|\.)Test$/.test(ann.text.replace(/^@/, '').trim())) return true;
    }
    return false;
}

/** Collect assert*(...) calls (kotlin.test / JUnit / AssertJ-style) within a test body. */
function collectKotlinAsserts(fn: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    for (const call of fn.descendantsOfType('call_expression')) {
        const callee = call.namedChildren[0];
        if (!callee) continue;
        const text = callee.text.replace(/\s+/g, '');
        if (/^assert/.test(text) || /(^|\.)assert\w*$/i.test(text)) {
            out.push(truncate(call.text));
        }
    }
    return out;
}

export const kotlinDescriptor: LanguageDescriptor = {
    name: 'kotlin',
    extensions: ['kt', 'kts'],
    grammarModule: 'tree-sitter-kotlin',
    queryFile: 'kotlin.scm',
    captureMap: [
        ['class', 'class']
    ],
    defaultSymbolType: 'function',
    decisionPoints: ['if_expression', 'for_statement', 'while_statement', 'catch_block'],
    normalizeDocstring(raw: string): string {
        // KDoc block (/** ... */) or plain line comments (// ...).
        return raw
            .replace(/^\/\*\*?/, '')
            .replace(/\*\/\s*$/, '')
            .replace(/^\s*\*\s?/gm, '')
            .replace(/^\s*\/\/\s?/gm, '')
            .trim();
    },
    resolveImport(node, fromQName, edges, captureName) {
        const text = node.text;

        if (captureName === 'relation.inherits') {
            edges.push({
                from_qname: fromQName,
                to_qname: `class:${text.split('(')[0].trim()}`,
                edge_type: 'inherits',
                dynamic: false
            });
        } else if (captureName === 'import.name') {
            edges.push({
                from_qname: fromQName,
                to_qname: `package:${text}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    },
    extractTestSpecs(root, filePath, fileQname): TestSpec[] {
        const specs: TestSpec[] = [];
        for (const fn of root.descendantsOfType('function_declaration')) {
            if (!hasTestAnnotation(fn)) continue;
            const name = fn.namedChildren.find(c => c.type === 'simple_identifier')?.text;
            if (!name) continue;
            specs.push({
                testQname: `${fileQname}#${name}`,
                title: name,
                targetQname: undefined,
                assertions: collectKotlinAsserts(fn),
                filePath,
                startLine: fn.startPosition.row + 1
            });
        }
        return specs;
    }
};

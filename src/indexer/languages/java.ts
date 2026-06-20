/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { LanguageDescriptor } from './descriptor';
import { TestSpec } from '../types';
import { truncate } from './test-spec-helpers';

/** True if a method_declaration carries a `@Test` annotation. */
function hasTestAnnotation(method: Parser.SyntaxNode): boolean {
    const modifiers = method.namedChildren.find(c => c.type === 'modifiers');
    if (!modifiers) return false;
    for (const mod of modifiers.namedChildren) {
        if (mod.type === 'marker_annotation' || mod.type === 'annotation') {
            const annName = mod.childForFieldName('name')?.text;
            if (annName === 'Test') return true;
        }
    }
    return false;
}

/** Collect assert*(...) / assertThat(...) invocations within a method body. */
function collectJavaAsserts(method: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    for (const call of method.descendantsOfType('method_invocation')) {
        const name = call.childForFieldName('name')?.text ?? '';
        if (name.startsWith('assert')) {
            out.push(truncate(call.text));
        }
    }
    return out;
}

export const javaDescriptor: LanguageDescriptor = {
    name: 'java',
    extensions: ['java'],
    grammarModule: 'tree-sitter-java',
    queryFile: 'java.scm',
    captureMap: [
        ['class', 'class'],
        ['interface', 'interface']
    ],
    defaultSymbolType: 'function',
    decisionPoints: ['if_statement', 'for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement', 'switch_label', 'catch_clause', 'ternary_expression', 'binary_expression'],
    resolveImport(node, fromQName, edges, captureName) {
        const text = node.text;
        if (captureName === 'relation.inherits') {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'inherits', dynamic: false });
        } else if (captureName === 'relation.implements') {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'implements', dynamic: false });
        } else if (captureName?.includes('import')) {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'depends_on', dynamic: false });
        }
    },
    extractTestSpecs(root, filePath, fileQname): TestSpec[] {
        const specs: TestSpec[] = [];
        for (const method of root.descendantsOfType('method_declaration')) {
            if (!hasTestAnnotation(method)) continue;
            const name = method.childForFieldName('name')?.text;
            if (!name) continue;
            specs.push({
                testQname: `${fileQname}#${name}`,
                title: name,
                targetQname: undefined,
                assertions: collectJavaAsserts(method),
                filePath,
                startLine: method.startPosition.row + 1
            });
        }
        return specs;
    }
};

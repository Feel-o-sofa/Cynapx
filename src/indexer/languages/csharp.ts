/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { LanguageDescriptor } from './descriptor';
import { TestSpec } from '../types';
import { inferProdFilePath, truncate } from './test-spec-helpers';

/** Test-method attributes across the three mainstream .NET frameworks. */
const TEST_ATTRIBUTES = new Set([
    'Fact', 'Theory',          // xUnit
    'Test', 'TestCase', 'TestCaseSource', // NUnit
    'TestMethod', 'DataTestMethod'        // MSTest
]);

/** True if a method_declaration carries an xUnit/NUnit/MSTest test attribute. */
function hasTestAttribute(method: Parser.SyntaxNode): boolean {
    for (const list of method.namedChildren) {
        if (list.type !== 'attribute_list') continue;
        for (const attr of list.descendantsOfType('attribute')) {
            // The attribute name is its first named child (identifier or
            // qualified_name, e.g. [Xunit.Fact]); match on the last segment.
            const name = attr.firstNamedChild?.text ?? '';
            const lastSegment = name.split('.').pop() ?? '';
            if (TEST_ATTRIBUTES.has(lastSegment)) return true;
        }
    }
    return false;
}

/** Collect Assert.* / CollectionAssert.* / StringAssert.* invocations within a test body. */
function collectCsharpAsserts(method: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    for (const call of method.descendantsOfType('invocation_expression')) {
        const callee = call.childForFieldName('function') ?? call.firstNamedChild;
        if (!callee) continue;
        const text = callee.text.replace(/\s+/g, '');
        if (/^(Assert|CollectionAssert|StringAssert)\./.test(text)) {
            out.push(truncate(call.text));
        }
    }
    return out;
}

export const csharpDescriptor: LanguageDescriptor = {
    name: 'csharp',
    extensions: ['cs'],
    grammarModule: 'tree-sitter-c-sharp',
    queryFile: 'csharp.scm',
    captureMap: [
        ['class', 'class'],
        ['interface', 'interface']
    ],
    defaultSymbolType: 'function',
    decisionPoints: ['if_statement', 'for_statement', 'foreach_statement', 'while_statement', 'switch_section', 'catch_clause'],
    normalizeDocstring(raw: string): string {
        return raw
            .replace(/^\s*\/\/\/\s?/gm, '')  // strip /// prefix
            .replace(/<\/?(?:summary|param|returns|remarks|example|exception|see|seealso|typeparam|value)[^>]*>/g, '')  // strip XML tags
            .replace(/\s+/g, ' ')  // collapse whitespace
            .trim();
    },
    resolveImport(node, fromQName, edges, captureName) {
        const text = node.text;
        if (captureName === 'relation.inherits') {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'inherits', dynamic: false });
        } else if (captureName?.includes('import')) {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'depends_on', dynamic: false });
        }
    },
    extractTestSpecs(root, filePath, fileQname): TestSpec[] {
        const specs: TestSpec[] = [];
        // `FooTests.cs` / `FooTest.cs` exercises `Foo.cs`.
        const targetQname = inferProdFilePath(filePath);
        for (const method of root.descendantsOfType('method_declaration')) {
            if (!hasTestAttribute(method)) continue;
            const name = method.childForFieldName('name')?.text;
            if (!name) continue;
            specs.push({
                testQname: `${fileQname}#${name}`,
                title: name,
                targetQname,
                assertions: collectCsharpAsserts(method),
                filePath,
                startLine: method.startPosition.row + 1
            });
        }
        return specs;
    }
};

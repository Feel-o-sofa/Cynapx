/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { LanguageDescriptor } from './descriptor';
import { TestSpec } from '../types';
import { inferProdFilePath, truncate } from './test-spec-helpers';

const GTEST_MACROS = new Set(['TEST', 'TEST_F', 'TEST_P', 'TYPED_TEST']);

/**
 * GoogleTest's `TEST(Suite, Name) { ... }` parses as a function_definition whose
 * declarator identifier is the macro name and whose "parameters" carry the suite
 * and test names as type_identifiers. Returns `[suite, name]` or undefined.
 */
function readGtestMacro(fn: Parser.SyntaxNode): [string, string] | undefined {
    const declarator = fn.namedChildren.find(c => c.type === 'function_declarator');
    if (!declarator) return undefined;
    const macro = declarator.namedChildren.find(c => c.type === 'identifier')?.text ?? '';
    if (!GTEST_MACROS.has(macro)) return undefined;
    const params = declarator.namedChildren.find(c => c.type === 'parameter_list');
    if (!params) return undefined;
    const idents = params.descendantsOfType('type_identifier').map(n => n.text);
    if (idents.length < 2) return undefined;
    return [idents[0], idents[1]];
}

/** Collect EXPECT_* / ASSERT_* invocations within a test body. */
function collectGtestAsserts(fn: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    for (const call of fn.descendantsOfType('call_expression')) {
        const callee = call.childForFieldName('function');
        if (!callee || callee.type !== 'identifier') continue;
        if (/^(EXPECT_|ASSERT_)/.test(callee.text)) {
            out.push(truncate(call.text));
        }
    }
    return out;
}

export const cppDescriptor: LanguageDescriptor = {
    name: 'cpp',
    extensions: ['cpp', 'cc', 'hpp', 'hxx'],
    grammarModule: 'tree-sitter-cpp',
    queryFile: 'cpp.scm',
    captureMap: [
        ['class', 'class'],
        ['function', 'function'],
        ['module', 'module']
    ],
    defaultSymbolType: 'field',
    decisionPoints: ['if_statement', 'for_statement', 'while_statement', 'catch_clause'],
    resolveImport(node, fromQName, edges, captureName) {
        if (captureName === 'relation.inherits') {
            edges.push({ from_qname: fromQName, to_qname: node.text, edge_type: 'inherits', dynamic: false });
            return;
        }

        const pathNode = node.descendantsOfType('string_content')[0] || node;
        if (pathNode) {
            const headerPath = pathNode.text.replace(/[<">]/g, '');
            edges.push({
                from_qname: fromQName,
                to_qname: `header:${headerPath}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    },
    extractTestSpecs(root, filePath, fileQname): TestSpec[] {
        const specs: TestSpec[] = [];
        // `calc_test.cpp` exercises `calc.cpp`.
        const targetQname = inferProdFilePath(filePath);
        for (const fn of root.descendantsOfType('function_definition')) {
            const gtest = readGtestMacro(fn);
            if (!gtest) continue;
            const [suite, name] = gtest;
            specs.push({
                testQname: `${fileQname}#${suite}.${name}`,
                title: `${suite}.${name}`,
                targetQname,
                assertions: collectGtestAsserts(fn),
                filePath,
                startLine: fn.startPosition.row + 1
            });
        }
        return specs;
    }
};

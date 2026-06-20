/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import * as path from 'path';
import { LanguageDescriptor } from './descriptor';
import { TestSpec } from '../types';
import { truncate } from './test-spec-helpers';
import { toCanonical } from '../../utils/paths';

/**
 * A `function_item` is a test if one of its immediately preceding
 * `attribute_item` siblings contains the `test` attribute (e.g. `#[test]`,
 * `#[tokio::test]`). Walk preceding siblings, stopping at the first non-attribute.
 */
function isRustTest(fn: Parser.SyntaxNode): boolean {
    let prev = fn.previousNamedSibling;
    while (prev && prev.type === 'attribute_item') {
        if (/\btest\b/.test(prev.text)) return true;
        prev = prev.previousNamedSibling;
    }
    return false;
}

/** Collect assert!/assert_eq!/assert_ne! macro invocations as strings. */
function collectRustAsserts(fn: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    for (const mac of fn.descendantsOfType('macro_invocation')) {
        const macroName = mac.childForFieldName('macro')?.text ?? '';
        if (macroName.startsWith('assert')) {
            out.push(truncate(mac.text));
        }
    }
    return out;
}

export const rustDescriptor: LanguageDescriptor = {
    name: 'rust',
    extensions: ['rs'],
    grammarModule: 'tree-sitter-rust',
    queryFile: 'rust.scm',
    captureMap: [
        ['class', 'class'],
        ['function', 'function'],
        ['interface', 'interface'],
        ['module', 'module']
    ],
    defaultSymbolType: 'field',
    decisionPoints: ['if_expression', 'for_expression', 'while_expression', 'loop_expression', 'match_arm', 'binary_expression'],
    normalizeDocstring(raw: string): string {
        return raw.replace(/^\s*\/\/[\/!]\s?/gm, '').trim();
    },
    resolveImport(node, fromQName, edges, _captureName, absFilePath) {
        if (node.type === 'mod_item') {
            // External module declaration `mod foo;` (no inline `{ ... }` body)
            // resolves to a sibling source file: `<dir>/foo.rs` or `<dir>/foo/mod.rs`.
            // Inline `mod foo { ... }` modules already become module nodes in the
            // definition pass, so skip those here.
            if (node.childForFieldName('body')) return;
            const name = node.childForFieldName('name')?.text;
            if (!name || !absFilePath) return;
            const dir = path.dirname(absFilePath);
            const candidates = [path.join(dir, `${name}.rs`), path.join(dir, name, 'mod.rs')];
            for (const candidate of candidates) {
                edges.push({
                    from_qname: fromQName,
                    to_qname: toCanonical(candidate),
                    edge_type: 'depends_on',
                    dynamic: false
                });
            }
            return;
        }

        const pathNode = node.descendantsOfType('identifier').pop();
        if (pathNode) {
            edges.push({
                from_qname: fromQName,
                to_qname: `crate:${pathNode.text}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    },
    extractTestSpecs(root, filePath, fileQname): TestSpec[] {
        const specs: TestSpec[] = [];
        // Tests may live at the top level or inside `#[cfg(test)] mod tests { ... }`,
        // so scan all function_item nodes and filter by the #[test] attribute.
        for (const fn of root.descendantsOfType('function_item')) {
            if (!isRustTest(fn)) continue;
            const name = fn.childForFieldName('name')?.text;
            if (!name) continue;
            specs.push({
                testQname: `${fileQname}#${name}`,
                title: name,
                targetQname: undefined,
                assertions: collectRustAsserts(fn),
                filePath,
                startLine: fn.startPosition.row + 1
            });
        }
        return specs;
    }
};

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

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
    decisionPoints: ['if_expression', 'for_expression', 'while_expression', 'match_arm'],
    resolveImport(node, fromQName, edges) {
        const pathNode = node.descendantsOfType('identifier').pop();
        if (pathNode) {
            edges.push({
                from_qname: fromQName,
                to_qname: `crate:${pathNode.text}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }
};

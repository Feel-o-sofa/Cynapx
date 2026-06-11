/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

export const gdscriptDescriptor: LanguageDescriptor = {
    name: 'gdscript',
    extensions: ['gd'],
    grammarModule: 'tree-sitter-gdscript',
    queryFile: 'gdscript.scm',
    captureMap: [
        ['class', 'class'],
        ['event', 'field']
    ],
    defaultSymbolType: 'function',
    decisionPoints: ['if_statement', 'for_statement', 'while_statement', 'match_arm'],
    resolveImport(node, fromQName, edges) {
        const parentNode = node.descendantsOfType('identifier')[0];
        if (parentNode) {
            edges.push({
                from_qname: fromQName,
                to_qname: `class:${parentNode.text}`,
                edge_type: 'inherits',
                dynamic: false
            });
        }
    }
};

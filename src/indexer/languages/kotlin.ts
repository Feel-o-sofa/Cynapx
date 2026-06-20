/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

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
    }
};

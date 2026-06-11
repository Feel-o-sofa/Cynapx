/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

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
    resolveImport(node, fromQName, edges, captureName) {
        if (captureName?.startsWith('relation')) {
            edges.push({
                from_qname: fromQName,
                to_qname: node.text,
                edge_type: captureName.endsWith('inherits') ? 'inherits' : 'implements',
                dynamic: false
            });
        }
    }
};

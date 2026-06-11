/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

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
    }
};

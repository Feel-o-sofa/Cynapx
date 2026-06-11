/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

export const cDescriptor: LanguageDescriptor = {
    name: 'c',
    extensions: ['c', 'h'],
    grammarModule: 'tree-sitter-c',
    queryFile: 'c.scm',
    captureMap: [
        ['class', 'class'],
        ['function', 'function']
    ],
    defaultSymbolType: 'field',
    decisionPoints: ['if_statement', 'for_statement', 'while_statement', 'case_statement'],
    resolveImport(node, fromQName, edges) {
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

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

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
    decisionPoints: ['if_statement', 'for_statement', 'while_statement', 'catch_clause'],
    resolveImport(node, fromQName, edges, captureName) {
        const text = node.text;
        if (captureName === 'relation.inherits') {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'inherits', dynamic: false });
        } else if (captureName === 'relation.implements') {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'implements', dynamic: false });
        } else if (captureName?.includes('import')) {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'depends_on', dynamic: false });
        }
    }
};

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

export const javascriptDescriptor: LanguageDescriptor = {
    name: 'javascript',
    extensions: ['js'],
    grammarModule: 'tree-sitter-javascript',
    queryFile: 'javascript.scm',
    captureMap: [
        ['class', 'class'],
        ['function', 'function'],
        ['method', 'method']
    ],
    defaultSymbolType: 'field',
    decisionPoints: [
        'if_statement', 'for_statement', 'while_statement', 'case_clause',
        'catch_clause', 'conditional_expression', 'binary_expression',
        'for_in_statement'
    ],
    resolveImport(node, fromQName, edges) {
        const nameCapture = node.children.find(c => c.type === 'string');
        if (nameCapture) {
            let pkgName = nameCapture.text;
            if (pkgName.startsWith("'") || pkgName.startsWith('"')) {
                pkgName = pkgName.substring(1, pkgName.length - 1);
            }
            if (!pkgName.startsWith('.')) {
                edges.push({
                    from_qname: fromQName,
                    to_qname: `package:${pkgName.split('/')[0]}`,
                    edge_type: 'depends_on',
                    dynamic: false
                });
            }
        }
    }
};

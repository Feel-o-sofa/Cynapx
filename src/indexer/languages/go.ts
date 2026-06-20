/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

export const goDescriptor: LanguageDescriptor = {
    name: 'go',
    extensions: ['go'],
    grammarModule: 'tree-sitter-go',
    queryFile: 'go.scm',
    captureMap: [
        ['class', 'class'],
        ['function', 'function'],
        ['method', 'method']
    ],
    defaultSymbolType: 'field',
    decisionPoints: ['if_statement', 'for_statement', 'expression_case', 'type_case', 'communication_case', 'binary_expression'],
    normalizeDocstring(raw: string): string {
        return raw.replace(/^\s*\/\/\s?/gm, '').trim();
    },
    resolveImport(node, fromQName, edges) {
        const pathNode = node.descendantsOfType('interpreted_string_literal')[0];
        if (pathNode) {
            const pkgPath = pathNode.text.replace(/"/g, '');
            edges.push({
                from_qname: fromQName,
                to_qname: `package:${pkgPath}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }
};

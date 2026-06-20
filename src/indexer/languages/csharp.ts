/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

export const csharpDescriptor: LanguageDescriptor = {
    name: 'csharp',
    extensions: ['cs'],
    grammarModule: 'tree-sitter-c-sharp',
    queryFile: 'csharp.scm',
    captureMap: [
        ['class', 'class'],
        ['interface', 'interface']
    ],
    defaultSymbolType: 'function',
    decisionPoints: ['if_statement', 'for_statement', 'foreach_statement', 'while_statement', 'switch_section', 'catch_clause'],
    normalizeDocstring(raw: string): string {
        return raw
            .replace(/^\s*\/\/\/\s?/gm, '')  // strip /// prefix
            .replace(/<\/?(?:summary|param|returns|remarks|example|exception|see|seealso|typeparam|value)[^>]*>/g, '')  // strip XML tags
            .replace(/\s+/g, ' ')  // collapse whitespace
            .trim();
    },
    resolveImport(node, fromQName, edges, captureName) {
        const text = node.text;
        if (captureName === 'relation.inherits') {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'inherits', dynamic: false });
        } else if (captureName?.includes('import')) {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'depends_on', dynamic: false });
        }
    }
};

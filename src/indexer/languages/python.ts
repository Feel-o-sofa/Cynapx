/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';

export const pythonDescriptor: LanguageDescriptor = {
    name: 'python',
    extensions: ['py'],
    grammarModule: 'tree-sitter-python',
    queryFile: 'python.scm',
    captureMap: [
        ['class', 'class'],
        ['function', 'function'],
        ['method', 'method']
    ],
    defaultSymbolType: 'field',
    decisionPoints: [
        'if_statement', 'for_statement', 'while_statement', 'case_clause',
        'catch_clause', 'conditional_expression', 'binary_expression',
        'for_in_statement', 'if_expression'
    ],
    resolveImport(node, fromQName, edges, captureName) {
        if (captureName === 'relation.inherits') {
            edges.push({ from_qname: fromQName, to_qname: node.text, edge_type: 'inherits', dynamic: false });
            return;
        }

        if (node.type === 'import_statement') {
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i)!;
                if (child.type === 'aliased_import') {
                    const nameNode = child.childForFieldName('name');
                    if (nameNode) {
                        const pkgName = nameNode.text.split('.')[0];
                        edges.push({ from_qname: fromQName, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false });
                    }
                } else if (child.type === 'dotted_name') {
                    const pkgName = child.text.split('.')[0];
                    edges.push({ from_qname: fromQName, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false });
                }
            }
        } else if (node.type === 'import_from_statement') {
            const moduleNode = node.childForFieldName('module_name');
            if (moduleNode) {
                const pkgName = moduleNode.text.split('.')[0];
                let isRelative = false;
                for (let i = 0; i < node.childCount; i++) {
                    if (node.child(i)!.type === 'relative_import' || node.child(i)!.text.startsWith('.')) {
                        isRelative = true;
                        break;
                    }
                }
                if (!isRelative) {
                    edges.push({ from_qname: fromQName, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false });
                }
            }
        }
    }
};

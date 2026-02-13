/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import Python from 'tree-sitter-python';
import Parser from 'tree-sitter';

export class PythonProvider implements LanguageProvider {
    public extensions = ['py'];
    public languageName = 'python';

    public getLanguage() {
        return Python;
    }

    public getQuery(): string {
        return `
            (function_definition 
                name: (identifier) @function.name 
                parameters: (parameters) @function.params
                return_type: (type)? @function.return) @function.def
            (class_definition 
                name: (identifier) @class.name
                (argument_list [(identifier) (attribute) (subscript)] @relation.inherits)?) @class.def
            (call function: (identifier) @call.name) @call.expr
            (import_statement) @import.stmt
            (import_from_statement) @import.from_stmt
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('method')) return 'method';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
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

    public getDecisionPoints(): string[] {
        return [
            'if_statement', 'for_statement', 'while_statement', 'case_clause',
            'catch_clause', 'conditional_expression', 'binary_expression',
            'for_in_statement', 'if_expression'
        ];
    }
}

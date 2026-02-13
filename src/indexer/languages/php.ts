/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import PHP from 'tree-sitter-php';
import Parser from 'tree-sitter';

export class PhpProvider implements LanguageProvider {
    public extensions = ['php'];
    public languageName = 'php';

    public getLanguage() {
        return PHP.php;
    }

    public getQuery(): string {
        return `
            (class_declaration name: (name) @class.name) @class.def
            (interface_declaration name: (name) @interface.name) @interface.def
            (trait_declaration name: (name) @interface.name) @interface.def
            
            (method_declaration name: (name) @method.name) @method.def
            (function_definition name: (name) @function.name) @function.def
            
            (base_clause (name) @relation.inherits)
            (class_interface_clause (name) @relation.implements)
            (use_declaration (name) @relation.inherits)

            (function_call_expression (name) @call.name) @call.expr
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('interface')) return 'interface';
        if (captureName.startsWith('method')) return 'method';
        return 'function';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        if (captureName?.startsWith('relation')) {
            edges.push({
                from_qname: fromQName,
                to_qname: node.text,
                edge_type: captureName.endsWith('inherits') ? 'inherits' : 'implements',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'foreach_statement', 'while_statement', 'catch_clause'];
    }
}

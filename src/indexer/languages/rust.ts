/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import Rust from 'tree-sitter-rust';
import Parser from 'tree-sitter';

export class RustProvider implements LanguageProvider {
    public extensions = ['rs'];
    public languageName = 'rust';

    public getLanguage() {
        return Rust;
    }

    public getQuery(): string {
        return `
            (function_item 
                name: (identifier) @function.name
                parameters: (parameters) @function.params
            ) @function.def
            (struct_item name: (type_identifier) @class.name) @class.def
            (enum_item name: (type_identifier) @class.name) @class.def
            (trait_item name: (type_identifier) @interface.name) @interface.def
            (impl_item type: (_) @class.name) @class.def
            (mod_item name: (identifier) @module.name) @module.def
            (call_expression function: (_) @call.name) @call.expr
            (use_declaration) @import.def
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('interface')) return 'interface';
        if (captureName.startsWith('module')) return 'module';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const pathNode = node.descendantsOfType('identifier').pop();
        if (pathNode) {
            edges.push({
                from_qname: fromQName,
                to_qname: `crate:${pathNode.text}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_expression', 'for_expression', 'while_expression', 'match_arm'];
    }
}

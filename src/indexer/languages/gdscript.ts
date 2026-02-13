/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import GDScript from 'tree-sitter-gdscript';
import Parser from 'tree-sitter';

export class GdscriptProvider implements LanguageProvider {
    public extensions = ['gd'];
    public languageName = 'gdscript';

    public getLanguage() {
        return GDScript;
    }

    public getQuery(): string {
        return `
            (class_name_statement name: (name) @class.name) @class.def
            (function_definition name: (name) @function.name) @function.def
            (signal_statement name: (name) @event.name) @event.def
            (call) @call.expr
            (extends_statement) @import.def
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('event')) return 'field';
        return 'function';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const parentNode = node.descendantsOfType('identifier')[0];
        if (parentNode) {
            edges.push({
                from_qname: fromQName,
                to_qname: `class:${parentNode.text}`,
                edge_type: 'inherits',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'while_statement', 'match_arm'];
    }
}

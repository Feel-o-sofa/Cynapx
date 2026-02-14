/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import Go from 'tree-sitter-go';
import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

export class GoProvider implements LanguageProvider {
    public extensions = ['go'];
    public languageName = 'go';

    public getLanguage() {
        return Go;
    }

    public getQuery(): string {
        const queryPath = path.resolve(__dirname, './queries/go.scm');
        return fs.readFileSync(queryPath, 'utf8');
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('method')) return 'method';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const pathNode = node.descendantsOfType('interpreted_string_literal')[0];
        if (pathNode) {
            let pkgPath = pathNode.text.replace(/"/g, '');
            edges.push({
                from_qname: fromQName,
                to_qname: `package:${pkgPath}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'expression_case_clause'];
    }
}

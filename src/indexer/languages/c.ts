/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import C from 'tree-sitter-c';
import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

export class CProvider implements LanguageProvider {
    public extensions = ['c', 'h'];
    public languageName = 'c';

    public getLanguage() {
        return C;
    }

    public getQuery(): string {
        const queryPath = path.resolve(__dirname, './queries/c.scm');
        return fs.readFileSync(queryPath, 'utf8');
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const pathNode = node.descendantsOfType('string_content')[0] || node;
        if (pathNode) {
            let headerPath = pathNode.text.replace(/[<">]/g, '');
            edges.push({
                from_qname: fromQName,
                to_qname: `header:${headerPath}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'while_statement', 'case_statement'];
    }
}

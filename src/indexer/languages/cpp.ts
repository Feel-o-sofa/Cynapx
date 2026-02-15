/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import CPP from 'tree-sitter-cpp';
import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

export class CppProvider implements LanguageProvider {
    public extensions = ['cpp', 'cc', 'hpp', 'hxx'];
    public languageName = 'cpp';

    public getLanguage() {
        return CPP;
    }

    public getQuery(): string {
        const queryPath = path.resolve(__dirname, './queries/cpp.scm');
        return fs.readFileSync(queryPath, 'utf8');
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('module')) return 'module';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        if (captureName === 'relation.inherits') {
            edges.push({ from_qname: fromQName, to_qname: node.text, edge_type: 'inherits', dynamic: false });
            return;
        }

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
        return ['if_statement', 'for_statement', 'while_statement', 'catch_clause'];
    }
}

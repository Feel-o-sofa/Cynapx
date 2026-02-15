/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import CSharp from 'tree-sitter-c-sharp';
import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

export class CsharpProvider implements LanguageProvider {
    public extensions = ['cs'];
    public languageName = 'csharp';

    public getLanguage() {
        return CSharp;
    }

    public getQuery(): string {
        const queryPath = path.resolve(__dirname, './queries/csharp.scm');
        return fs.readFileSync(queryPath, 'utf8');
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('interface')) return 'interface';
        return 'function';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const text = node.text;
        if (captureName === 'relation.inherits') {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'inherits', dynamic: false });
        } else if (captureName?.includes('import')) {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'depends_on', dynamic: false });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'foreach_statement', 'while_statement', 'switch_section', 'catch_clause'];
    }
}

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import Java from 'tree-sitter-java';
import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

export class JavaProvider implements LanguageProvider {
    public extensions = ['java'];
    public languageName = 'java';

    public getLanguage() {
        return Java;
    }

    public getQuery(): string {
        const queryPath = path.resolve(__dirname, './queries/java.scm');
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
        } else if (captureName === 'relation.implements') {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'implements', dynamic: false });
        } else if (captureName?.includes('import')) {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'depends_on', dynamic: false });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'while_statement', 'catch_clause'];
    }
}

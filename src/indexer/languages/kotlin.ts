/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import Kotlin from 'tree-sitter-kotlin';
import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

export class KotlinProvider implements LanguageProvider {
    public extensions = ['kt', 'kts'];
    public languageName = 'kotlin';

    public getLanguage() {
        return Kotlin;
    }

    public getQuery(): string {
        const queryPath = path.resolve(__dirname, './queries/kotlin.scm');
        return fs.readFileSync(queryPath, 'utf8');
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        return 'function';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const text = node.text;

        if (captureName === 'relation.inherits') {
            edges.push({
                from_qname: fromQName,
                to_qname: `class:${text.split('(')[0].trim()}`,
                edge_type: 'inherits',
                dynamic: false
            });
        } else if (captureName === 'import.name') {
            edges.push({
                from_qname: fromQName,
                to_qname: `package:${text}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_expression', 'for_statement', 'while_statement', 'catch_block'];
    }
}

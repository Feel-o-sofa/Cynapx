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
import * as fs from 'fs';
import * as path from 'path';

export class RustProvider implements LanguageProvider {
    public extensions = ['rs'];
    public languageName = 'rust';

    public getLanguage() {
        return Rust;
    }

    public getQuery(): string {
        const queryPath = path.resolve(__dirname, './queries/rust.scm');
        return fs.readFileSync(queryPath, 'utf8');
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

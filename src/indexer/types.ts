/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { CodeNode, CodeEdge, SymbolType, EdgeType } from '../types';
import Parser from 'tree-sitter';

export type ChangeType = 'ADD' | 'MODIFY' | 'DELETE';

export interface FileChangeEvent {
    event: ChangeType;
    file_path: string;
    commit: string;
}

/**
 * Represents an edge before it is resolved to database IDs.
 */
export interface RawCodeEdge {
    from_qname: string;
    to_qname: string;
    edge_type: EdgeType;
    dynamic: boolean;
    call_site_line?: number;
    target_file_hint?: string;
}

/**
 * P7: A captured test specification — an it()/test() block, its expect()
 * assertions, and the symbol it verifies. Gives agents behavioral contracts.
 */
export interface TestSpec {
    testQname: string;
    title: string;
    targetQname?: string;
    assertions: string[];
    filePath: string;
    startLine: number;
}

export interface DeltaGraph {
    nodes: CodeNode[];
    edges: RawCodeEdge[];
    testSpecs?: TestSpec[];  // P7
}

/**
 * Interface for language-specific parsers.
 */
export interface CodeParser {
    supports(filePath: string): boolean;
    parse(filePath: string, commit: string, version: number): Promise<DeltaGraph>;
}

/**
 * Interface for language-specific logic used by TreeSitterParser.
 */
export interface LanguageProvider {
    extensions: string[];
    languageName: string;
    getLanguage(): any;
    getQuery(): string;
    mapCaptureToSymbolType(captureName: string): SymbolType;
    resolveImport?(node: Parser.SyntaxNode, filePath: string, edges: RawCodeEdge[], captureName?: string): void;
    getDecisionPoints(): string[];
}

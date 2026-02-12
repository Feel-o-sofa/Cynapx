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

export interface DeltaGraph {
    nodes: CodeNode[];
    edges: RawCodeEdge[];
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
    resolveImport?(node: Parser.SyntaxNode, filePath: string, edges: RawCodeEdge[]): void;
    getDecisionPoints(): string[];
}

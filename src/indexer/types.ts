import { CodeNode, CodeEdge } from '../types';

export type ChangeType = 'ADD' | 'MODIFY' | 'DELETE';

export interface FileChangeEvent {
    event: ChangeType;
    file_path: string;
    commit: string;
}

export interface DeltaGraph {
    nodes: CodeNode[];
    edges: CodeEdge[];
}

/**
 * Interface for language-specific parsers.
 */
export interface CodeParser {
    supports(filePath: string): boolean;
    parse(filePath: string, commit: string, version: number): Promise<DeltaGraph>;
}

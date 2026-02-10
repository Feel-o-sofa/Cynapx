import { DeltaGraph, CodeParser } from './types';
import { CodeNode, CodeEdge } from '../types';

/**
 * A dummy parser for initial bootstrap and testing.
 * In a real scenario, this would use tree-sitter or similar to produce actual AST-based data.
 */
export class DummyParser implements CodeParser {
    public supports(filePath: string): boolean {
        return filePath.endsWith('.ts') || filePath.endsWith('.js');
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        // This is a placeholder that simulates parsing results
        // Real implementation would extract classes, methods, and calls
        return {
            nodes: [],
            edges: []
        };
    }
}

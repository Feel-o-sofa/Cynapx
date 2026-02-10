/**
 * Common Symbol Types as defined in the logical scheme.
 */
export type SymbolType = 'file' | 'module' | 'class' | 'interface' | 'method' | 'function' | 'field' | 'test';

/**
 * Visibility types for symbols.
 */
export type Visibility = 'public' | 'protected' | 'internal' | 'private';

/**
 * Node interface representing a symbol in the knowledge graph.
 */
export interface CodeNode {
    id?: number;
    qualified_name: string;
    symbol_type: SymbolType;
    language: string;
    file_path: string;
    start_line: number;
    end_line: number;
    visibility: Visibility;
    is_generated: boolean;
    last_updated_commit: string;
    version: number;

    // Optional attributes
    checksum?: string;
    modifiers?: string[]; // Stored as JSON in DB
    signature?: string;
    return_type?: string;
    field_type?: string;

    // Metrics
    loc?: number;
    cyclomatic?: number;
    fan_in?: number;
    fan_out?: number;
}

/**
 * Edge types representing relationships between symbols.
 */
export type EdgeType =
    | 'defines' | 'contains' | 'namespace_of'
    | 'inherits' | 'implements'
    | 'calls' | 'overrides' | 'reads' | 'writes'
    | 'tests' | 'depends_on';

/**
 * Edge interface representing a relationship in the knowledge graph.
 */
export interface CodeEdge {
    from_id: number;
    to_id: number;
    edge_type: EdgeType;
    dynamic: boolean;
    call_site_line?: number;
}

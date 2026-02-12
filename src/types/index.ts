/**
 * Common Symbol Types as defined in the logical scheme.
 */
export type SymbolType = 'file' | 'module' | 'class' | 'interface' | 'method' | 'function' | 'field' | 'test' | 'package';

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
    fan_in_dynamic?: number;
    fan_out_dynamic?: number;
}

/**
 * Edge types representing relationships between symbols.
 */
export type EdgeType =
    | 'defines' | 'contains' | 'namespace_of'
    | 'inherits' | 'implements' | 'implements_trait'
    | 'calls' | 'dynamic_calls' | 'overrides' | 'reads' | 'writes'
    | 'tests' | 'depends_on'
    | 'emits' | 'connects_to';

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

/**
 * Represents a resource that can be disposed of (e.g., DB connection, worker pool).
 */
export interface Disposable {
    dispose(): Promise<void> | void;
}

/**
 * Structured error codes for AI agents.
 */
export enum CynapxErrorCode {
    INITIALIZATION_REQUIRED = 'INITIALIZATION_REQUIRED',
    SYMBOL_NOT_FOUND = 'SYMBOL_NOT_FOUND',
    PATH_TRAVERSAL_DENIED = 'PATH_TRAVERSAL_DENIED',
    CONSISTENCY_CHECK_IN_PROGRESS = 'CONSISTENCY_CHECK_IN_PROGRESS',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    INVALID_PARAMETER = 'INVALID_PARAMETER'
}

export class CynapxError extends Error {
    constructor(public code: CynapxErrorCode, message: string) {
        super(message);
        this.name = 'CynapxError';
    }
}

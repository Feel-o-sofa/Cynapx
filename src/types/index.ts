/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
/**
 * Common Symbol Types as defined in the logical scheme.
 */
export type SymbolType = 'file' | 'module' | 'class' | 'interface' | 'method' | 'function' | 'field' | 'test' | 'package' | 'config_key' | 'section';

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

    // Boundaryless Edge Discovery (Task 31)
    remote_project_path?: string;

    // Structural Characteristic Tagging (Task 32)
    tags?: string[]; // Stored as JSON in DB

    // Historical Evidence Mapping (Task 33)
    history?: {
        hash: string;
        message: string;
        author: string;
        date: string;
    }[]; // Stored as JSON in DB

    // Semantic Clustering (Task 24)
    cluster_id?: number;
}

/**
 * [Phase 12] Remediation Strategy
 */
export interface RemediationRecipe {
    strategy: string;
    rationale: string;
    steps: string[];
}

/**
 * [Phase 12] Risk Profile
 */
export interface RiskProfile {
    symbol: string;
    score: number; // 0.0 to 1.0
    level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    factors: {
        metric: string;
        value: number | string;
        impact: number;
    }[];
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

export interface OptimizationReport {
    /** HIGH confidence: private methods with fan_in=0 — likely genuine dead code */
    high: CodeNode[];
    /** MEDIUM confidence: public methods with fan_in=0 tagged trait:internal */
    medium: CodeNode[];
    /** LOW confidence: public methods with fan_in=0 — may be external API */
    low: CodeNode[];
    /** Backward-compatible alias for high */
    potentialDeadCode: CodeNode[];
    summary: {
        totalSymbols: number;
        highConfidenceDead: number;
        mediumConfidenceDead: number;
        lowConfidenceDead: number;
        /** Total dead symbols across all tiers */
        deadSymbols: number;
        optimizationPotential: string;
    };
}

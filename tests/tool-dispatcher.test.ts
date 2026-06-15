/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for executeTool() in tool-dispatcher.ts.
 * Focuses on input validation behavior (C-1 metric whitelist, purge safety guard).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool, ToolDeps } from '../src/server/tool-dispatcher';

// ---------------------------------------------------------------------------
// Minimal mock ToolDeps
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
    const mockGraphEngine = {
        getNodeByQualifiedName: vi.fn().mockReturnValue(null),
        nodeRepo: { searchSymbols: vi.fn().mockReturnValue([]) },
        // export_graph fixture: a tiny 2-node / 1-edge graph so json/graphml/dot
        // branches all produce non-trivial output.
        exportToMermaid: vi.fn().mockResolvedValue('```mermaid\ngraph TD\n  A-->B\n```'),
        getGraphData: vi.fn().mockResolvedValue({
            nodes: [
                { id: 1, qualified_name: '/src/a.ts#A' },
                { id: 2, qualified_name: '/src/b.ts#B' },
            ],
            edges: [
                { from_id: 1, to_id: 2 },
            ],
        }),
    };

    const mockDb = {
        prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
    };

    const mockCtx = {
        graphEngine: mockGraphEngine,
        dbManager: { getDb: vi.fn().mockReturnValue(mockDb) },
        projectPath: '/mock/project',
        securityProvider: null,
        archEngine: null,
        refactorEngine: null,
        optEngine: null,
        policyDiscoverer: null,
        gitService: null,
        updatePipeline: null,
        vectorRepo: null,
    };

    const base: ToolDeps = {
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
        getContext: vi.fn().mockReturnValue(mockCtx),
        isTerminal: vi.fn().mockReturnValue(false),
        getTerminalCoordinator: vi.fn().mockReturnValue(undefined),
        embeddingProvider: {
            generate: vi.fn().mockResolvedValue([]),
            generateBatch: vi.fn().mockResolvedValue([]),
            getDimensions: vi.fn().mockReturnValue(0),
            getModelName: vi.fn().mockReturnValue('mock'),
        },
        workspaceManager: {
            getAllContexts: vi.fn().mockReturnValue([]),
        } as any,
        remediationEngine: {} as any,
        onInitialize: undefined,
        onPurge: undefined,
        markReady: vi.fn(),
        getIsInitialized: vi.fn().mockReturnValue(false),
        setIsInitialized: vi.fn(),
    };

    return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// get_hotspots — metric validation (C-1 fix)
// ---------------------------------------------------------------------------

describe('executeTool: get_hotspots metric validation', () => {
    const VALID_METRICS = ['cyclomatic', 'fan_in', 'fan_out', 'loc'];

    for (const metric of VALID_METRICS) {
        it(`accepts valid metric "${metric}" without returning isError`, async () => {
            const deps = makeDeps();
            const result = await executeTool('get_hotspots', { metric, threshold: 0 }, deps);
            expect(result.isError).toBeUndefined();
            expect(result.content).toBeDefined();
        });
    }

    it('rejects SQL-injection-style metric and returns isError: true', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_hotspots', { metric: 'loc; DROP TABLE--' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Invalid metric/i);
    });

    it('rejects an unknown metric string and returns isError: true', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_hotspots', { metric: 'unknown_column' }, deps);
        expect(result.isError).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// get_symbol_details — missing qualified_name
// ---------------------------------------------------------------------------

describe('executeTool: get_symbol_details', () => {
    it('returns isError when symbol is not found (missing qualified_name)', async () => {
        const deps = makeDeps();
        // getContext().graphEngine.getNodeByQualifiedName returns null (default mock)
        const result = await executeTool('get_symbol_details', { qualified_name: undefined }, deps);
        // M-4 validation: empty/undefined qualified_name is caught before DB lookup
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/qualified_name|not found/i);
    });
});

// ---------------------------------------------------------------------------
// purge_index — safety guard
// ---------------------------------------------------------------------------

describe('executeTool: purge_index', () => {
    it('returns a warning and does NOT purge when confirm is missing', async () => {
        const deps = makeDeps();
        const result = await executeTool('purge_index', {}, deps);
        // Should not call setIsInitialized (which would indicate actual purge ran)
        expect(deps.setIsInitialized).not.toHaveBeenCalled();
        const text: string = result.content[0].text;
        expect(text).toMatch(/WARNING|confirm/i);
    });

    it('returns a warning and does NOT purge when confirm is false', async () => {
        const deps = makeDeps();
        const result = await executeTool('purge_index', { confirm: false }, deps);
        expect(deps.setIsInitialized).not.toHaveBeenCalled();
        const text: string = result.content[0].text;
        expect(text).toMatch(/WARNING|confirm/i);
    });
});

// ---------------------------------------------------------------------------
// get_related_tests
// ---------------------------------------------------------------------------

describe('executeTool: get_related_tests', () => {
    it('returns isError when context is missing', async () => {
        const deps = makeDeps({ getContext: vi.fn().mockReturnValue(null) });
        const result = await executeTool('get_related_tests', { qualified_name: 'some#Symbol' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/No active project/i);
    });

    it('returns isError when qualified_name is missing', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_related_tests', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Invalid argument: qualified_name must be a non-empty string/i);
    });

    it('returns isError for a non-string qualified_name', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_related_tests', { qualified_name: 123 }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/non-empty string/i);
    });

    it('returns isError for an empty-string qualified_name', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_related_tests', { qualified_name: '' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/non-empty string/i);
    });

    it('returns [] (not error) for a valid symbol with no tests edges', async () => {
        const mockGraphEngine = {
            getNodeByQualifiedName: vi.fn().mockReturnValue({ id: 42, symbol_type: 'class', file_path: '/src/foo.ts', qualified_name: '/src/foo.ts#MyClass' }),
            getNodeById: vi.fn().mockReturnValue(null),
            getIncomingEdges: vi.fn().mockReturnValue([]),
        };
        const deps = makeDeps({
            getContext: vi.fn().mockReturnValue({
                graphEngine: mockGraphEngine,
                dbManager: { getDb: vi.fn().mockReturnValue({ prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }) }) },
                projectPath: '/mock/project',
            }),
        });
        const result = await executeTool('get_related_tests', { qualified_name: '/src/foo.ts#MyClass' }, deps);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// backfill_history
// ---------------------------------------------------------------------------

describe('executeTool: backfill_history', () => {
    it('returns isError when context is missing', async () => {
        const deps = makeDeps({ getContext: vi.fn().mockReturnValue(null) });
        const result = await executeTool('backfill_history', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/No active project/i);
    });

    it('returns isError in Terminal mode', async () => {
        const deps = makeDeps({ isTerminal: vi.fn().mockReturnValue(true) });
        const result = await executeTool('backfill_history', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Terminal mode/i);
    });

    it('calls mapHistoryToProject and returns success when context + pipeline exist', async () => {
        const mapHistoryToProject = vi.fn().mockResolvedValue(undefined);
        const deps = makeDeps({
            getContext: vi.fn().mockReturnValue({
                graphEngine: {
                    getNodeByQualifiedName: vi.fn().mockReturnValue(null),
                    nodeRepo: { searchSymbols: vi.fn().mockReturnValue([]) },
                },
                updatePipeline: { mapHistoryToProject },
                projectPath: '/mock/project',
            }),
        });
        const result = await executeTool('backfill_history', {}, deps);
        expect(mapHistoryToProject).toHaveBeenCalledOnce();
        expect(result.isError).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// H-1: requireEngine() guard — uninitialized engine components must produce
// an isError ToolResult (EngineNotReadyError) instead of crashing on
// `ctx.xxx!` against undefined/null.
// ---------------------------------------------------------------------------

describe('executeTool: H-1 requireEngine guard (EngineNotReadyError)', () => {
    it('check_architecture_violations returns isError when archEngine is not ready', async () => {
        const deps = makeDeps();
        const result = await executeTool('check_architecture_violations', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/archEngine.*not ready/i);
    });

    it('find_dead_code returns isError when optEngine is not ready', async () => {
        const deps = makeDeps();
        const result = await executeTool('find_dead_code', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/optEngine.*not ready/i);
    });

    it('get_risk_profile returns isError when refactorEngine is not ready', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_risk_profile', { qualified_name: '/src/foo.ts#Bar' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/refactorEngine.*not ready/i);
    });

    it('propose_refactor returns isError when refactorEngine is not ready', async () => {
        const deps = makeDeps();
        const result = await executeTool('propose_refactor', { qualified_name: '/src/foo.ts#Bar' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/refactorEngine.*not ready/i);
    });

    it('discover_latent_policies returns isError when policyDiscoverer is not ready', async () => {
        const deps = makeDeps();
        const result = await executeTool('discover_latent_policies', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/policyDiscoverer.*not ready/i);
    });

    // Phase 24-1 (M-2 v21): handler arg validation aligned to the real
    // threshold / min_count args (previously dead-validated min_confidence /
    // max_policies). Validation runs after the ctx check and before the engine
    // call, so a working policyDiscoverer stub is injected.
    function depsWithPolicyDiscoverer() {
        return makeDeps({
            getContext: vi.fn().mockReturnValue({
                policyDiscoverer: { discoverPolicies: async () => [] },
            }),
        });
    }

    it('discover_latent_policies returns isError for threshold out of 0-1 range', async () => {
        const deps = depsWithPolicyDiscoverer();
        const result = await executeTool('discover_latent_policies', { threshold: 1.5 }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/threshold must be a number between 0 and 1/i);
    });

    it('discover_latent_policies returns isError for non-positive-integer min_count', async () => {
        const deps = depsWithPolicyDiscoverer();
        const result = await executeTool('discover_latent_policies', { min_count: -1 }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/min_count must be a positive integer/i);
    });

    it('discover_latent_policies accepts valid threshold/min_count args', async () => {
        const deps = depsWithPolicyDiscoverer();
        const result = await executeTool('discover_latent_policies', { threshold: 0.5, min_count: 2 }, deps);
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toBeDefined();
    });

    it('backfill_history returns isError when updatePipeline is not ready', async () => {
        const deps = makeDeps({
            getContext: vi.fn().mockReturnValue({
                graphEngine: {
                    getNodeByQualifiedName: vi.fn().mockReturnValue(null),
                    nodeRepo: { searchSymbols: vi.fn().mockReturnValue([]) },
                },
                projectPath: '/mock/project',
                // updatePipeline intentionally absent — engine still initializing
            }),
        });
        const result = await executeTool('backfill_history', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/updatePipeline.*not ready/i);
    });

    it('check_consistency returns isError when graphEngine is not ready', async () => {
        const deps = makeDeps({
            getContext: vi.fn().mockReturnValue({
                projectPath: '/mock/project',
                // graphEngine, gitService, updatePipeline all absent
            }),
        });
        const result = await executeTool('check_consistency', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/graphEngine.*not ready/i);
    });
});

// ---------------------------------------------------------------------------
// get_setup_context — embeddings field
// ---------------------------------------------------------------------------

describe('executeTool: get_setup_context', () => {
    it('includes an embeddings field in the response when context exists', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_setup_context', {}, deps);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed).toHaveProperty('embeddings');
    });
});

// ---------------------------------------------------------------------------
// Phase 18-1 (M-1 v15): dispatcher-level coverage for the 6 tools that were
// previously exercised only by scripts/integration-test.js (not run in CI).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// export_graph — pure branching (no-context guard, json/graphml/dot formats,
// unknown-format error). Priority 1 per the plan.
// ---------------------------------------------------------------------------

describe('executeTool: export_graph', () => {
    it('returns isError when context is missing', async () => {
        const deps = makeDeps({ getContext: vi.fn().mockReturnValue(null) });
        const result = await executeTool('export_graph', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/No active project/i);
    });

    it('defaults to json format and emits the graph-export skeleton', async () => {
        const deps = makeDeps();
        const result = await executeTool('export_graph', {}, deps);
        expect(result.isError).toBeUndefined();
        const text: string = result.content[0].text;
        expect(text).toContain('### Graph Export');
        expect(text).toContain('Nodes:');
        expect(text).toContain('Edges:');
        expect(text).toContain('```mermaid');
    });

    it('produces a GraphML document for format=graphml', async () => {
        const deps = makeDeps();
        const result = await executeTool('export_graph', { format: 'graphml' }, deps);
        expect(result.isError).toBeUndefined();
        const text: string = result.content[0].text;
        expect(text).toContain('<?xml');
        expect(text).toContain('<graphml');
        expect(text).toContain('<node');
        expect(text).toContain('<edge');
    });

    it('produces a DOT digraph for format=dot', async () => {
        const deps = makeDeps();
        const result = await executeTool('export_graph', { format: 'dot' }, deps);
        expect(result.isError).toBeUndefined();
        const text: string = result.content[0].text;
        expect(text).toContain('digraph G {');
        expect(text).toContain('->');
        expect(text).toContain('}');
    });

    it('returns isError for an unsupported format', async () => {
        const deps = makeDeps();
        const result = await executeTool('export_graph', { format: 'bogus' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Supported: json, graphml, dot/);
    });
});

// ---------------------------------------------------------------------------
// search_symbols — empty-result and EngineNotReadyError branches.
// ---------------------------------------------------------------------------

describe('executeTool: search_symbols', () => {
    it('returns isError when query is missing (undefined)', async () => {
        const deps = makeDeps();
        const result = await executeTool('search_symbols', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/non-empty string/i);
    });

    it('returns isError when query is a non-string (number)', async () => {
        const deps = makeDeps();
        const result = await executeTool('search_symbols', { query: 123 }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/non-empty string/i);
    });

    it('returns isError when query is an empty string', async () => {
        const deps = makeDeps();
        const result = await executeTool('search_symbols', { query: '' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/non-empty string/i);
    });

    it('returns isError when query is whitespace only', async () => {
        const deps = makeDeps();
        const result = await executeTool('search_symbols', { query: '   ' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/non-empty string/i);
    });

    it('returns an empty JSON array when there are no contexts', async () => {
        // Default makeDeps: workspaceManager.getAllContexts() -> []
        const deps = makeDeps();
        const result = await executeTool('search_symbols', { query: 'foo' }, deps);
        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(0);
    });

    it('surfaces an error when every context is not ready (O-12)', async () => {
        // A context whose graphEngine is absent -> requireEngine throws
        // EngineNotReadyError, which search_symbols converts to isError.
        const deps = makeDeps({
            workspaceManager: {
                getAllContexts: vi.fn().mockReturnValue([{ projectPath: '/mock/project' }]),
            } as any,
        });
        const result = await executeTool('search_symbols', { query: 'foo' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not ready|initializing/i);
    });
});

// ---------------------------------------------------------------------------
// analyze_impact — arg validation and symbol-not-found branches.
// ---------------------------------------------------------------------------

describe('executeTool: analyze_impact', () => {
    it('returns isError for a missing/non-string qualified_name', async () => {
        const deps = makeDeps();
        const result = await executeTool('analyze_impact', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/qualified_name/i);
    });

    it('returns isError when the symbol is not found', async () => {
        // Default mock: getNodeByQualifiedName -> null
        const deps = makeDeps();
        const result = await executeTool('analyze_impact', { qualified_name: '/src/a.ts#A' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not found/i);
    });
});

// ---------------------------------------------------------------------------
// get_callers — arg validation and symbol-not-found branches.
// ---------------------------------------------------------------------------

describe('executeTool: get_callers', () => {
    it('returns isError for a missing/non-string qualified_name', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_callers', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/qualified_name/i);
    });

    it('returns isError when the symbol is not found', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_callers', { qualified_name: '/src/a.ts#A' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not found/i);
    });
});

// ---------------------------------------------------------------------------
// get_callees — arg validation and symbol-not-found branches.
// ---------------------------------------------------------------------------

describe('executeTool: get_callees', () => {
    it('returns isError for a missing/non-string qualified_name', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_callees', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/qualified_name/i);
    });

    it('returns isError when the symbol is not found', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_callees', { qualified_name: '/src/a.ts#A' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not found/i);
    });
});

// ---------------------------------------------------------------------------
// get_remediation_strategy — required-argument guards.
// ---------------------------------------------------------------------------

describe('executeTool: get_remediation_strategy', () => {
    it('returns isError when the violation argument is missing', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_remediation_strategy', {}, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/violation/i);
    });

    it('returns isError when the violation object lacks source/target', async () => {
        const deps = makeDeps();
        const result = await executeTool('get_remediation_strategy', { violation: {} }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/source.*target|required/i);
    });
});

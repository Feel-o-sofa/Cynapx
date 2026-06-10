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
        expect(result.content[0].text).toMatch(/qualified_name/i);
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

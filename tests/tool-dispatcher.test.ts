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
        // Symbol not found should yield an error response, not throw
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/not found/i);
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

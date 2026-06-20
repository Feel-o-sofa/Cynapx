/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * A-4 (Phase 14-5): MCP `notifications/progress` minimal wiring.
 *
 * Verifies that long-running tools emit `notifications/progress` (with the
 * caller-supplied progress token) when a token is present, emit nothing when no
 * token is present, and that result payloads are unchanged either way.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeTool, registerToolHandlers, ToolDeps } from '../src/server/tool-dispatcher';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
    createProgressReporter,
    NOOP_PROGRESS,
    SendNotification
} from '../src/server/tools/_progress';

// ---------------------------------------------------------------------------
// Minimal mock ToolDeps with a working updatePipeline / git for long tools
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
    const mockCtx: any = {
        graphEngine: {
            getNodeByQualifiedName: vi.fn().mockReturnValue(null),
            nodeRepo: { searchSymbols: vi.fn().mockReturnValue([]) },
        },
        updatePipeline: {
            mapHistoryToProject: vi.fn().mockResolvedValue(undefined),
            reTagAllNodes: vi.fn().mockResolvedValue(undefined),
        },
        gitService: {},
        projectPath: '/mock/project',
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
        } as any,
        workspaceManager: { getAllContexts: vi.fn().mockReturnValue([]) } as any,
        remediationEngine: {} as any,
        onInitialize: undefined,
        onPurge: undefined,
        markReady: vi.fn(),
        getIsInitialized: vi.fn().mockReturnValue(false),
        setIsInitialized: vi.fn(),
    };
    return { ...base, ...overrides };
}

/** Captures progress notifications sent through a reporter. */
function makeRecordingReporter(token: string | number) {
    const sent: Array<{ method: string; params: any }> = [];
    const send: SendNotification = async (n) => { sent.push(n); };
    return { reporter: createProgressReporter(token, send), sent };
}

// ---------------------------------------------------------------------------
// createProgressReporter unit behavior
// ---------------------------------------------------------------------------

describe('createProgressReporter', () => {
    it('returns a no-op reporter (enabled=false) when token is undefined', async () => {
        const send = vi.fn();
        const r = createProgressReporter(undefined, send as any);
        expect(r.enabled).toBe(false);
        await r.report(1, 2, 'x');
        expect(send).not.toHaveBeenCalled();
    });

    it('emits a notifications/progress with the token when a token is present', async () => {
        const { reporter, sent } = makeRecordingReporter('tok-123');
        expect(reporter.enabled).toBe(true);
        await reporter.report(2, 4, 'halfway');
        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe('notifications/progress');
        expect(sent[0].params).toMatchObject({
            progressToken: 'tok-123',
            progress: 2,
            total: 4,
            message: 'halfway',
        });
    });

    it('supports numeric progress tokens', async () => {
        const { reporter, sent } = makeRecordingReporter(99);
        await reporter.report(1, undefined, 'm');
        expect(sent[0].params.progressToken).toBe(99);
        expect(sent[0].params.total).toBeUndefined();
    });

    it('swallows errors from the underlying sender (best-effort)', async () => {
        const send: SendNotification = async () => { throw new Error('transport gone'); };
        const r = createProgressReporter('t', send);
        await expect(r.report(1, 1, 'm')).resolves.toBeUndefined();
    });

    it('NOOP_PROGRESS is disabled and never throws', async () => {
        expect(NOOP_PROGRESS.enabled).toBe(false);
        await expect(NOOP_PROGRESS.report(1, 1, 'm')).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// executeTool: progress emitted only with a token; payload unchanged
// ---------------------------------------------------------------------------

describe('executeTool: progress emission for long-running tools', () => {
    it('backfill_history emits progress notifications when a token is provided', async () => {
        const deps = makeDeps();
        const { reporter, sent } = makeRecordingReporter('bf-token');
        const result = await executeTool('backfill_history', {}, deps, reporter);
        expect(result.isError).toBeUndefined();
        expect(sent.length).toBeGreaterThanOrEqual(1);
        for (const n of sent) {
            expect(n.method).toBe('notifications/progress');
            expect(n.params.progressToken).toBe('bf-token');
        }
    });

    it('backfill_history emits NO notifications when no token is provided', async () => {
        const deps = makeDeps();
        const send = vi.fn();
        // Default param => NOOP_PROGRESS (no token path).
        const result = await executeTool('backfill_history', {}, deps);
        expect(result.isError).toBeUndefined();
        expect(send).not.toHaveBeenCalled();
    });

    it('re_tag_project emits progress notifications when a token is provided', async () => {
        const deps = makeDeps();
        const { reporter, sent } = makeRecordingReporter('rt-token');
        const result = await executeTool('re_tag_project', {}, deps, reporter);
        expect(result.isError).toBeUndefined();
        expect(sent.length).toBeGreaterThanOrEqual(1);
        expect(sent.every(n => n.params.progressToken === 'rt-token')).toBe(true);
    });

    it('result payload is byte-for-byte identical with and without a progress token', async () => {
        const withTokenDeps = makeDeps();
        const { reporter } = makeRecordingReporter('x');
        const withToken = await executeTool('backfill_history', {}, withTokenDeps, reporter);

        const withoutTokenDeps = makeDeps();
        const withoutToken = await executeTool('backfill_history', {}, withoutTokenDeps);

        expect(JSON.stringify(withToken)).toBe(JSON.stringify(withoutToken));
        expect(withToken.content[0].text).toBe('Successfully backfilled Git history.');
    });

    it('initialize_project (mode=current) emits monotonic progress with total=4', async () => {
        const tmpRoot = process.cwd();
        const onInitialize = vi.fn().mockResolvedValue(undefined);
        const deps = makeDeps({ onInitialize });
        const { reporter, sent } = makeRecordingReporter(7);
        const result = await executeTool(
            'initialize_project',
            { mode: 'current', path: tmpRoot, zero_pollution: true },
            deps,
            reporter
        );
        expect(result.isError).toBeUndefined();
        expect(onInitialize).toHaveBeenCalledOnce();
        // first stage progress=0, last stage progress=4 (total=4 throughout)
        expect(sent.length).toBeGreaterThanOrEqual(2);
        expect(sent[0].params.progress).toBe(0);
        expect(sent[sent.length - 1].params.progress).toBe(4);
        expect(sent.every(n => n.params.total === 4)).toBe(true);
        const progresses = sent.map(n => n.params.progress);
        for (let i = 1; i < progresses.length; i++) {
            expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
        }
    });

    it('initialize_project emits nothing when no token is provided (payload unchanged)', async () => {
        const tmpRoot = process.cwd();
        const onInitialize = vi.fn().mockResolvedValue(undefined);
        const deps = makeDeps({ onInitialize });
        const result = await executeTool(
            'initialize_project',
            { mode: 'current', path: tmpRoot, zero_pollution: true },
            deps
        );
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toMatch(/Successfully initialized project/);
    });
});

// ---------------------------------------------------------------------------
// CallToolRequest handler: derives the progress token from request _meta and
// routes notifications through extra.sendNotification.
// ---------------------------------------------------------------------------

describe('registerToolHandlers: CallToolRequest -> progress token wiring', () => {
    /** Captures the registered CallTool handler from a fake sdkServer. */
    function captureCallToolHandler(deps: ToolDeps) {
        let callToolHandler: ((req: any, extra: any) => Promise<any>) | undefined;
        const fakeSdkServer: any = {
            setRequestHandler: (schema: any, handler: any) => {
                if (schema === CallToolRequestSchema) callToolHandler = handler;
            },
        };
        registerToolHandlers(fakeSdkServer, deps);
        if (!callToolHandler) throw new Error('CallTool handler not registered');
        return callToolHandler;
    }

    it('emits progress via extra.sendNotification when _meta.progressToken is set', async () => {
        const deps = makeDeps();
        const handler = captureCallToolHandler(deps);
        const sent: any[] = [];
        const extra = { sendNotification: async (n: any) => { sent.push(n); } };
        const result = await handler(
            { params: { name: 'backfill_history', arguments: {}, _meta: { progressToken: 'meta-tok' } } },
            extra
        );
        expect(result.isError).toBeUndefined();
        expect(sent.length).toBeGreaterThanOrEqual(1);
        expect(sent.every(n => n.method === 'notifications/progress' && n.params.progressToken === 'meta-tok')).toBe(true);
    });

    it('emits NO progress when request has no _meta.progressToken', async () => {
        const deps = makeDeps();
        const handler = captureCallToolHandler(deps);
        const sendNotification = vi.fn().mockResolvedValue(undefined);
        const result = await handler(
            { params: { name: 'backfill_history', arguments: {} } },
            { sendNotification }
        );
        expect(result.isError).toBeUndefined();
        expect(sendNotification).not.toHaveBeenCalled();
    });
});

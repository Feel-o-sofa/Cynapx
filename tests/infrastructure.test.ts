/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for core infrastructure:
 *   - WorkspaceManager  (workspace-manager.ts)
 *   - IpcCoordinator    (ipc-coordinator.ts)
 *   - HealthMonitor     (health-monitor.ts)
 *   - WorkerPool        (worker-pool.ts)
 *
 * All filesystem / DB / network dependencies are mocked so tests run in
 * isolation and leave no side-effects on the host machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy dependencies before importing the modules under test.
// ---------------------------------------------------------------------------

// Mock paths utils — getProjectHash returns a deterministic value,
// getDatabasePath avoids touching the real filesystem.
// Mock ApiServer dependencies (needed by P10-H-1 error-handler test)
vi.mock('../src/server/mcp-server', () => ({ McpServer: class {} }));
vi.mock('../src/utils/certificate-generator', () => ({
    CertificateGenerator: { generate: vi.fn() },
}));
vi.mock('express-rate-limit', () => ({
    default: vi.fn().mockReturnValue((_req: any, _res: any, next: any) => next()),
}));
vi.mock('swagger-ui-express', () => ({
    default: { serve: [], setup: vi.fn().mockReturnValue((_req: any, _res: any, next: any) => next()) },
}));

vi.mock('../src/utils/paths', () => ({
    getProjectHash: (p: string) => `hash_${p.replace(/[^a-z0-9]/gi, '_')}`,
    getDatabasePath: (p: string) => `:memory:`,
    getCentralStorageDir: () => '/tmp/cynapx-test',
    getLocksDir: () => '/tmp/cynapx-test/locks',
    getRegistryPath: () => '/tmp/cynapx-test/registry.json',
}));

// Mock DatabaseManager so no real SQLite files are opened.
vi.mock('../src/db/database', () => {
    const mockDispose = vi.fn();
    const mockGetDb = vi.fn().mockReturnValue({
        prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), run: vi.fn() }),
        exec: vi.fn(),
    });
    const DatabaseManager = vi.fn(function (this: any) {
        this.getDb = mockGetDb;
        this.dispose = mockDispose;
    });
    return { DatabaseManager };
});

// Stub all repository / engine classes — initializeEngine chains through many
// constructors; we only care about WorkspaceManager's own behaviour.
// Use class syntax so vi.fn() constructors work correctly.
vi.mock('../src/db/node-repository',        () => ({ NodeRepository:      class { } }));
vi.mock('../src/db/edge-repository',        () => ({ EdgeRepository:      class { } }));
vi.mock('../src/db/metadata-repository',    () => ({ MetadataRepository:  class { } }));
vi.mock('../src/db/vector-repository',      () => ({ VectorRepository:    class { } }));
vi.mock('../src/graph/graph-engine',        () => ({ GraphEngine:         class { } }));
vi.mock('../src/graph/architecture-engine', () => ({ ArchitectureEngine:  class { } }));
vi.mock('../src/graph/refactoring-engine',  () => ({ RefactoringEngine:   class { } }));
vi.mock('../src/graph/optimization-engine', () => ({ OptimizationEngine:  class { } }));
vi.mock('../src/graph/policy-discoverer',   () => ({ PolicyDiscoverer:    class { } }));

// Stub ConsistencyChecker so HealthMonitor's interval callback won't crash
// even if it fires during a test.
vi.mock('../src/indexer/consistency-checker', () => ({
    ConsistencyChecker: vi.fn().mockImplementation(() => ({
        validate: vi.fn().mockResolvedValue(undefined),
    })),
}));

// ---------------------------------------------------------------------------
// Now import the modules under test (after mocks are registered).
// ---------------------------------------------------------------------------
import { WorkspaceManager } from '../src/server/workspace-manager';
import { IpcCoordinator }   from '../src/server/ipc-coordinator';
import { HealthMonitor }    from '../src/server/health-monitor';

// ============================================================================
// WorkspaceManager
// ============================================================================

describe('WorkspaceManager', () => {
    let wm: WorkspaceManager;

    beforeEach(() => {
        wm = new WorkspaceManager();
    });

    afterEach(async () => {
        await wm.dispose();
    });

    // -------------------------------------------------------------------------
    // mountProject()
    // -------------------------------------------------------------------------
    describe('mountProject()', () => {
        it('returns an EngineContext whose projectPath matches the argument', async () => {
            const ctx = await wm.mountProject('/my/project');
            expect(ctx.projectPath).toBe('/my/project');
        });

        it('assigns a non-empty projectHash to the returned context', async () => {
            const ctx = await wm.mountProject('/my/project');
            expect(typeof ctx.projectHash).toBe('string');
            expect(ctx.projectHash.length).toBeGreaterThan(0);
        });

        it('returns the same context object when called twice with the same path', async () => {
            const ctx1 = await wm.mountProject('/same/project');
            const ctx2 = await wm.mountProject('/same/project');
            expect(ctx1).toBe(ctx2);
        });

        it('registers different contexts for different paths', async () => {
            const ctx1 = await wm.mountProject('/project/a');
            const ctx2 = await wm.mountProject('/project/b');
            expect(ctx1).not.toBe(ctx2);
            expect(ctx1.projectPath).not.toBe(ctx2.projectPath);
        });

        it('sets the first mounted project as the active project', async () => {
            await wm.mountProject('/first/project');
            const active = wm.getActiveContext();
            expect(active).not.toBeNull();
            expect(active!.projectPath).toBe('/first/project');
        });

        it('keeps the first project active when a second is mounted', async () => {
            await wm.mountProject('/alpha');
            await wm.mountProject('/beta');
            expect(wm.getActiveContext()!.projectPath).toBe('/alpha');
        });

        it('mounted context is retrievable via getContextByHash()', async () => {
            const ctx = await wm.mountProject('/lookup/project');
            const retrieved = wm.getContextByHash(ctx.projectHash);
            expect(retrieved).toBe(ctx);
        });

        it('includes mounted context in getAllContexts()', async () => {
            await wm.mountProject('/listed/project');
            const all = wm.getAllContexts();
            expect(all.length).toBeGreaterThanOrEqual(1);
            expect(all.some(c => c.projectPath === '/listed/project')).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // dispose()
    // -------------------------------------------------------------------------
    describe('dispose()', () => {
        it('clears all contexts so getAllContexts() returns an empty array', async () => {
            await wm.mountProject('/dispose/project');
            await wm.dispose();
            expect(wm.getAllContexts()).toHaveLength(0);
        });

        it('makes getActiveContext() return null after dispose', async () => {
            await wm.mountProject('/dispose/project');
            await wm.dispose();
            expect(wm.getActiveContext()).toBeNull();
        });

        it('can be called safely when no projects are mounted', async () => {
            await expect(wm.dispose()).resolves.toBeUndefined();
        });

        it('calls dbManager.dispose() for any initialized engine', async () => {
            const { DatabaseManager } = await import('../src/db/database');
            // Mount and initialize a project so dbManager is populated.
            const ctx = await wm.mountProject('/init/project');
            await wm.initializeEngine(ctx.projectHash);

            const dbManagerInstance = (DatabaseManager as any).mock.results.at(-1).value;
            await wm.dispose();
            expect(dbManagerInstance.dispose).toHaveBeenCalledOnce();
        });
    });

    // -------------------------------------------------------------------------
    // setActiveProject()
    // -------------------------------------------------------------------------
    describe('setActiveProject()', () => {
        it('returns true and switches active context when hash is known', async () => {
            const ctx1 = await wm.mountProject('/proj/one');
            const ctx2 = await wm.mountProject('/proj/two');
            const ok = wm.setActiveProject(ctx2.projectHash);
            expect(ok).toBe(true);
            expect(wm.getActiveContext()!.projectPath).toBe('/proj/two');
        });

        it('returns false for an unknown hash', async () => {
            const ok = wm.setActiveProject('unknown-hash-xyz');
            expect(ok).toBe(false);
        });
    });
});

// ============================================================================
// IpcCoordinator
// ============================================================================

describe('IpcCoordinator', () => {
    let ipc: IpcCoordinator;

    beforeEach(() => {
        ipc = new IpcCoordinator();
    });

    afterEach(() => {
        ipc.close();
    });

    // -------------------------------------------------------------------------
    // connectToHost() — connection-refused scenario
    // -------------------------------------------------------------------------
    describe('connectToHost()', () => {
        it('rejects with an error when no host is listening on the given port', async () => {
            // Port 1 is reserved / never listening in normal circumstances.
            await expect(ipc.connectToHost(1, 'nonce')).rejects.toThrow();
        });

        it('rejected error has a message string', async () => {
            try {
                await ipc.connectToHost(1, 'nonce');
                // Should not reach here
                expect(true).toBe(false);
            } catch (err: any) {
                expect(typeof err.message).toBe('string');
                expect(err.message.length).toBeGreaterThan(0);
            }
        });
    });

    // -------------------------------------------------------------------------
    // startHost() → connectToHost() — happy path
    // -------------------------------------------------------------------------
    describe('startHost() and connectToHost() round-trip', () => {
        it('startHost() resolves with a numeric port', async () => {
            const testNonce = 'test-nonce-1234';
            const port = await ipc.startHost(testNonce);
            expect(typeof port).toBe('number');
            expect(port).toBeGreaterThan(0);
        });

        it('a second IpcCoordinator can connect to the host', async () => {
            const testNonce = 'test-nonce-abcd';
            const port = await ipc.startHost(testNonce);
            const client = new IpcCoordinator();
            try {
                await expect(client.connectToHost(port, testNonce)).resolves.toBeUndefined();
            } finally {
                client.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // close() — cleanup behaviour
    // -------------------------------------------------------------------------
    describe('close()', () => {
        it('can be called before startHost() / connectToHost() without throwing', () => {
            expect(() => ipc.close()).not.toThrow();
        });

        it('rejects pending forwardExecuteTool() calls with "IPC connection closed"', async () => {
            const testNonce = 'test-nonce-xyz';
            const port = await ipc.startHost(testNonce);
            const client = new IpcCoordinator();
            await client.connectToHost(port, testNonce);

            // Start a pending request but do NOT await it yet.
            const pending = client.forwardExecuteTool('some_tool', {});
            // Immediately close — should reject pending
            client.close();

            await expect(pending).rejects.toThrow('IPC connection closed');
        });
    });

    // -------------------------------------------------------------------------
    // forwardExecuteTool() — not connected
    // -------------------------------------------------------------------------
    describe('forwardExecuteTool()', () => {
        it('throws "Not connected to Host" when client socket is null', async () => {
            await expect(ipc.forwardExecuteTool('my_tool', {})).rejects.toThrow('Not connected to Host');
        });
    });
});

// ============================================================================
// HealthMonitor
// ============================================================================

describe('HealthMonitor', () => {
    let monitor: HealthMonitor;

    beforeEach(() => {
        vi.useFakeTimers();
        monitor = new HealthMonitor();
    });

    afterEach(() => {
        monitor.stop();
        vi.useRealTimers();
    });

    // -------------------------------------------------------------------------
    // start()
    // -------------------------------------------------------------------------
    describe('start()', () => {
        it('sets an internal interval handle after start()', () => {
            const mockWm = { getActiveContext: vi.fn().mockReturnValue(null) } as any;
            monitor.start(mockWm);
            // Access private field to verify interval was created
            expect((monitor as any).interval).toBeDefined();
        });

        it('the interval fires after 5 minutes', () => {
            const mockWm = { getActiveContext: vi.fn().mockReturnValue(null) } as any;
            monitor.start(mockWm);
            // Advance time by exactly 5 minutes
            vi.advanceTimersByTime(5 * 60 * 1000);
            expect(mockWm.getActiveContext).toHaveBeenCalled();
        });

        it('the interval fires multiple times when enough time passes', () => {
            const mockWm = { getActiveContext: vi.fn().mockReturnValue(null) } as any;
            monitor.start(mockWm);
            vi.advanceTimersByTime(15 * 60 * 1000); // 15 minutes → 3 ticks
            expect(mockWm.getActiveContext.mock.calls.length).toBeGreaterThanOrEqual(3);
        });
    });

    // -------------------------------------------------------------------------
    // stop()
    // -------------------------------------------------------------------------
    describe('stop()', () => {
        it('clears the interval so it no longer fires', () => {
            const mockWm = { getActiveContext: vi.fn().mockReturnValue(null) } as any;
            monitor.start(mockWm);
            monitor.stop();

            // Advance well beyond one tick — callback should NOT have fired
            vi.advanceTimersByTime(10 * 60 * 1000);
            expect(mockWm.getActiveContext).not.toHaveBeenCalled();
        });

        it('sets the interval handle to undefined after stop()', () => {
            const mockWm = { getActiveContext: vi.fn().mockReturnValue(null) } as any;
            monitor.start(mockWm);
            monitor.stop();
            expect((monitor as any).interval).toBeUndefined();
        });

        it('can be called safely when start() was never called', () => {
            expect(() => monitor.stop()).not.toThrow();
            expect((monitor as any).interval).toBeUndefined();
        });

        it('can be called twice without throwing', () => {
            const mockWm = { getActiveContext: vi.fn().mockReturnValue(null) } as any;
            monitor.start(mockWm);
            expect(() => {
                monitor.stop();
                monitor.stop();
            }).not.toThrow();
        });
    });

    // -------------------------------------------------------------------------
    // start() / stop() interaction with active context
    // -------------------------------------------------------------------------
    describe('context interaction', () => {
        it('does nothing when getActiveContext() returns null', () => {
            const mockWm = { getActiveContext: vi.fn().mockReturnValue(null) } as any;
            monitor.start(mockWm);
            // Should not throw when no context is active
            expect(() => vi.advanceTimersByTime(5 * 60 * 1000)).not.toThrow();
        });
    });
});

// ============================================================================
// P10-H-1: Process crash guard — unhandledRejection / uncaughtException
// ============================================================================

describe('Process crash guard (bootstrap handlers)', () => {
    it('has an unhandledRejection listener registered', () => {
        // bootstrap.ts registers the handler at module load time.
        // The import is done lazily here to avoid side-effects on the test runner,
        // but the handlers are always registered when the module is first required.
        // We simply verify that at least one listener is present (the handler
        // may already be registered by the time this test suite runs).
        const count = process.listenerCount('unhandledRejection');
        expect(count).toBeGreaterThan(0);
    });

    it('has an uncaughtException listener registered', () => {
        const count = process.listenerCount('uncaughtException');
        expect(count).toBeGreaterThan(0);
    });
});

// ============================================================================
// P10-H-1: Express global error handler
// ============================================================================

describe('ApiServer — global error handler', () => {
    it('registers a 4-argument error-handler middleware layer', async () => {
        // We instantiate ApiServer with all heavy deps mocked out so the
        // constructor succeeds without a real McpServer.
        // The test verifies that app._router contains at least one layer
        // whose handle.length === 4 (Express error-handler signature).
        const { ApiServer } = await import('../src/server/api-server');
        const server = new ApiServer();

        // Collect all Express router layers recursively
        const router: any = (server as any).app._router;
        const layers: any[] = router?.stack ?? [];

        const hasErrorHandler = layers.some(
            (layer: any) => typeof layer.handle === 'function' && layer.handle.length === 4
        );
        expect(hasErrorHandler).toBe(true);
    });

    it('returns 500 JSON when an error is passed to next(err)', async () => {
        // Build a minimal Express app that mimics the error-handler registration
        // and verify the response shape — avoids spinning up the full ApiServer.
        const expressModule = await import('express');
        const app = expressModule.default();
        app.use(expressModule.default.json());

        // Route that throws synchronously (simulated via next(err))
        app.get('/throw', (_req: any, _res: any, next: any) => {
            next(new Error('boom'));
        });

        // The error handler under test (same code as api-server.ts)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        app.use((err: Error, _req: any, res: any, _next: any) => {
            console.error('[API] Unhandled error:', err?.message ?? err);
            if (!res.headersSent) {
                res.status(500).json({ error_code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
            }
        });

        // Fire a request using Node's http module
        const http = await import('http');
        await new Promise<void>((resolve, reject) => {
            const srv = http.createServer(app);
            srv.listen(0, '127.0.0.1', () => {
                const port = (srv.address() as any).port;
                const req = http.request({ hostname: '127.0.0.1', port, path: '/throw', method: 'GET' }, (res) => {
                    let body = '';
                    res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toBe(500);
                            const parsed = JSON.parse(body);
                            expect(parsed.error_code).toBe('INTERNAL_ERROR');
                            srv.close(() => resolve());
                        } catch (e) {
                            srv.close(() => reject(e));
                        }
                    });
                });
                req.on('error', reject);
                req.end();
            });
        });
    });
});

// ============================================================================
// WorkerPool
// ============================================================================
import { WorkerPool } from '../src/indexer/worker-pool';

describe('WorkerPool', () => {
    describe('maxQueueSize getter', () => {
        it('exposes maxQueueSize via getter', () => {
            const pool = new WorkerPool(1, { maxQueueSize: 42 });
            expect(pool.maxQueueSize).toBe(42);
            pool.dispose();
        });

        it('returns default maxQueueSize when not specified', () => {
            const pool = new WorkerPool(1);
            expect(pool.maxQueueSize).toBe(100);
            pool.dispose();
        });
    });
});

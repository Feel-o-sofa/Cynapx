/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 12-6 commit A (server/IPC cleanup):
 * - O-1: search-symbols limit clamped to <= 200
 * - O-12: api-server payload logging redacts sensitive fields
 * - A-9: ipc-coordinator error type guard + pendingRequests cleanup on close
 * - A-10: lifecycle-manager dispose() timeout via Promise.race
 * - A-11: edge-repository invalidateStatementCache() drops cached statements
 */
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { IpcCoordinator } from '../src/server/ipc-coordinator';
import { LifecycleManager } from '../src/utils/lifecycle-manager';
import { EdgeRepository } from '../src/db/edge-repository';
import { searchSymbolsHandler } from '../src/server/tools/search-symbols';
import { redactSensitiveFields } from '../src/server/api-server';
import type { ToolDeps } from '../src/server/tool-dispatcher';

function createInMemoryDb(): Database.Database {
    const db = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');
    const filteredSchema = fullSchema
        .split(';')
        .filter(stmt => !stmt.includes('vec0'))
        .join(';');
    db.exec(filteredSchema);
    return db;
}

describe('O-1/M4: search-symbols limit clamp (real handler)', () => {
    // M5: invoke the real handler instead of re-implementing the clamp inline.
    function makeDeps(searchSymbols: ReturnType<typeof vi.fn>): ToolDeps {
        return {
            workspaceManager: {
                getAllContexts: () => [{
                    projectPath: '/mock/project',
                    projectHash: 'hash',
                    graphEngine: { nodeRepo: { searchSymbols } },
                }],
            },
            embeddingProvider: { generate: vi.fn() },
        } as unknown as ToolDeps;
    }

    it('clamps an oversized limit to 200', async () => {
        const searchSymbols = vi.fn().mockReturnValue([]);
        await searchSymbolsHandler.execute({ query: 'foo', limit: 100000 }, makeDeps(searchSymbols));
        expect(searchSymbols).toHaveBeenCalledWith('foo', 200, { symbol_type: undefined });
    });

    it('keeps a small limit unchanged', async () => {
        const searchSymbols = vi.fn().mockReturnValue([]);
        await searchSymbolsHandler.execute({ query: 'foo', limit: 5 }, makeDeps(searchSymbols));
        expect(searchSymbols).toHaveBeenCalledWith('foo', 5, { symbol_type: undefined });
    });

    it('defaults to 10 when limit is missing', async () => {
        const searchSymbols = vi.fn().mockReturnValue([]);
        await searchSymbolsHandler.execute({ query: 'foo' }, makeDeps(searchSymbols));
        expect(searchSymbols).toHaveBeenCalledWith('foo', 10, { symbol_type: undefined });
    });

    it('M4 regression: clamps a negative limit to 1 (never reaches SQLite as LIMIT -1)', async () => {
        const searchSymbols = vi.fn().mockReturnValue([]);
        await searchSymbolsHandler.execute({ query: 'foo', limit: -1 }, makeDeps(searchSymbols));
        expect(searchSymbols).toHaveBeenCalledWith('foo', 1, { symbol_type: undefined });
    });
});

describe('O-12: redactSensitiveFields (real export from api-server)', () => {
    it('redacts top-level sensitive fields', () => {
        const result = redactSensitiveFields({ token: 'abc123', name: 'foo' }) as any;
        expect(result.token).toBe('[REDACTED]');
        expect(result.name).toBe('foo');
    });

    it('redacts nested sensitive fields', () => {
        const result = redactSensitiveFields({ settings: { password: 'hunter2' }, data: { value: 1 } }) as any;
        expect(result.settings.password).toBe('[REDACTED]');
        expect(result.data.value).toBe(1);
    });

    it('redacts sensitive fields within arrays', () => {
        const result = redactSensitiveFields([{ apiKey: 'xyz' }, { ok: true }]) as any[];
        expect(result[0].apiKey).toBe('[REDACTED]');
        expect(result[1].ok).toBe(true);
    });

    it('L4: redacts passwd/credential/cookie/session keys', () => {
        const result = redactSensitiveFields({
            passwd: 'x', credentials: 'y', cookie: 'z', session_id: 'w',
        }) as any;
        expect(result.passwd).toBe('[REDACTED]');
        expect(result.credentials).toBe('[REDACTED]');
        expect(result.cookie).toBe('[REDACTED]');
        expect(result.session_id).toBe('[REDACTED]');
    });

    it('L4: redacts standalone auth keys but not author', () => {
        const result = redactSensitiveFields({
            auth: 'bearer xyz', auth_header: 'v', author: 'jane', authorization: 'w',
        }) as any;
        expect(result.auth).toBe('[REDACTED]');
        expect(result.auth_header).toBe('[REDACTED]');
        expect(result.author).toBe('jane');
        expect(result.authorization).toBe('[REDACTED]');
    });
});

describe('A-9: IpcCoordinator error type guard + pendingRequests cleanup', () => {
    it('rejects in-flight forwardExecuteTool requests when the connection closes', async () => {
        const host = new IpcCoordinator();
        const client = new IpcCoordinator();
        const nonce = 'test-nonce';

        const port = await host.startHost(nonce);
        await client.connectToHost(port, nonce);

        const pending = client.forwardExecuteTool('some-tool', {});

        // Force-close the underlying connection without waiting for the 30s timeout.
        (client as any).client.destroy();

        await expect(pending).rejects.toThrow('IPC connection closed');

        host.close();
        client.close();
    });

    it('responds with a string error message even when executeTool throws a non-Error value', async () => {
        const mcpServer = { executeTool: vi.fn().mockRejectedValue('plain string failure') } as any;
        const host = new IpcCoordinator(mcpServer);
        const client = new IpcCoordinator();
        const nonce = 'test-nonce-2';

        const port = await host.startHost(nonce);
        await client.connectToHost(port, nonce);

        await expect(client.forwardExecuteTool('some-tool', {})).rejects.toThrow('plain string failure');

        host.close();
        client.close();
    });
});

describe('A-10: LifecycleManager dispose() timeout', () => {
    it('does not hang forever when a resource dispose() never resolves', async () => {
        vi.useFakeTimers();
        const lifecycle = new LifecycleManager();
        const fastDispose = vi.fn().mockResolvedValue(undefined);
        lifecycle.track({ dispose: fastDispose });
        lifecycle.track({ dispose: () => new Promise<void>(() => { /* never resolves */ }) });

        const disposePromise = lifecycle.disposeAll();
        await vi.advanceTimersByTimeAsync(5000);
        await disposePromise;

        expect(fastDispose).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('continues disposing remaining resources after one throws', async () => {
        const lifecycle = new LifecycleManager();
        const order: string[] = [];
        lifecycle.track({ dispose: () => { order.push('first'); } });
        lifecycle.track({ dispose: () => { throw new Error('boom'); } });
        lifecycle.track({ dispose: () => { order.push('third'); } });

        await lifecycle.disposeAll();

        // Reverse order: third, then the throwing one, then first.
        expect(order).toEqual(['third', 'first']);
    });
});

describe('A-11: EdgeRepository.invalidateStatementCache()', () => {
    it('continues to function correctly after cache invalidation', () => {
        const db = createInMemoryDb();
        const edgeRepo = new EdgeRepository(db);

        db.prepare(`
            INSERT INTO nodes (qualified_name, symbol_type, language, file_path, start_line, end_line, visibility, is_generated, last_updated_commit, version)
            VALUES ('a.ts#A', 'function', 'typescript', 'a.ts', 1, 1, 'public', 0, 'abc', 1),
                   ('a.ts#B', 'function', 'typescript', 'a.ts', 2, 2, 'public', 0, 'abc', 1)
        `).run();

        edgeRepo.createEdge({ from_id: 1, to_id: 2, edge_type: 'CALLS', dynamic: false });
        expect(edgeRepo.getAllEdges()).toHaveLength(1);

        edgeRepo.invalidateStatementCache();

        // Statements should be transparently re-prepared and continue to work.
        expect(edgeRepo.getAllEdges()).toHaveLength(1);
        edgeRepo.createEdge({ from_id: 2, to_id: 1, edge_type: 'CALLS', dynamic: false });
        expect(edgeRepo.getAllEdges()).toHaveLength(2);
        expect(edgeRepo.getOutgoingEdges(1)).toHaveLength(1);
        expect(edgeRepo.getIncomingEdges(1)).toHaveLength(1);

        db.close();
    });
});

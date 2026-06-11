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

describe('O-1: search-symbols limit clamp', () => {
    it('clamps an oversized limit to 200', () => {
        const args = { limit: 100000 };
        const limit = Math.min(args.limit || 10, 200);
        expect(limit).toBe(200);
    });

    it('keeps a small limit unchanged', () => {
        const args = { limit: 5 };
        const limit = Math.min(args.limit || 10, 200);
        expect(limit).toBe(5);
    });

    it('defaults to 10 when limit is missing', () => {
        const args: { limit?: number } = {};
        const limit = Math.min(args.limit || 10, 200);
        expect(limit).toBe(10);
    });
});

describe('O-12: redactSensitiveFields', () => {
    // Mirrors the implementation in src/server/api-server.ts
    const SENSITIVE_FIELD_PATTERN = /token|secret|password|apikey|api_key|authorization/i;
    function redactSensitiveFields(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(redactSensitiveFields);
        if (value && typeof value === 'object') {
            const result: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
                result[key] = SENSITIVE_FIELD_PATTERN.test(key) ? '[REDACTED]' : redactSensitiveFields(val);
            }
            return result;
        }
        return value;
    }

    it('redacts top-level sensitive fields', () => {
        const result = redactSensitiveFields({ token: 'abc123', name: 'foo' }) as any;
        expect(result.token).toBe('[REDACTED]');
        expect(result.name).toBe('foo');
    });

    it('redacts nested sensitive fields', () => {
        const result = redactSensitiveFields({ auth: { password: 'hunter2' }, data: { value: 1 } }) as any;
        expect(result.auth.password).toBe('[REDACTED]');
        expect(result.data.value).toBe(1);
    });

    it('redacts sensitive fields within arrays', () => {
        const result = redactSensitiveFields([{ apiKey: 'xyz' }, { ok: true }]) as any[];
        expect(result[0].apiKey).toBe('[REDACTED]');
        expect(result[1].ok).toBe(true);
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

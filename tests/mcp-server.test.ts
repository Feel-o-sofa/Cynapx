/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { describe, it, expect, vi } from 'vitest';

// H-1 regression: waitUntilReady() must not flip isInitialized to true on its
// own. Readiness is signaled exclusively via markReady(true) once the engine
// context (graphEngine, dbManager, etc.) has actually been constructed.
vi.mock('../src/utils/paths', async (importOriginal) => {
    const original = await importOriginal<typeof import('../src/utils/paths')>();
    return {
        ...original,
        readRegistry: vi.fn(() => [{ path: process.cwd(), name: 'test-project' }]),
    };
});

import { McpServer } from '../src/server/mcp-server';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

describe('McpServer.waitUntilReady (H-1)', () => {
    it('does not mark itself ready before markReady(true) is called', async () => {
        const server = new McpServer();
        expect(server.isReady).toBe(false);

        let resolved = false;
        const waitPromise = (server as any).waitUntilReady().then(() => { resolved = true; });

        // Give the microtask queue a chance to run; waitUntilReady() should
        // still be blocked on readyPromise even though the project is registered.
        await new Promise(r => setImmediate(r));
        expect(resolved).toBe(false);
        expect(server.isReady).toBe(false);

        server.markReady(true);
        await waitPromise;

        expect(resolved).toBe(true);
        expect(server.isReady).toBe(true);
    });

    it('throws for unregistered projects without flipping isInitialized', async () => {
        const { readRegistry } = await import('../src/utils/paths');
        (readRegistry as any).mockReturnValueOnce([{ path: '/some/other/project', name: 'other' }]);

        const server = new McpServer();
        await expect((server as any).waitUntilReady()).rejects.toThrow(McpError);
        expect(server.isReady).toBe(false);
    });
});

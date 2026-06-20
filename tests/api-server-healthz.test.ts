/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * P13-1 (C-1 / v9 A-8 잔존) — /healthz behavior regression tests, HTTP level:
 *   1. /healthz must be reachable WITHOUT a Bearer token (Docker/k8s probes
 *      cannot send auth headers — the Dockerfile HEALTHCHECK relies on this).
 *   2. /healthz must return 503 while the engine is still pending and 200
 *      once a context with an open DB exists.
 *   3. Auth must still be enforced for every other endpoint.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as https from 'https';
import { ApiServer } from '../src/server/api-server';

const TEST_TOKEN = 'healthz-test-token';

/** Starts an ApiServer on an ephemeral port and resolves with its base URL. */
function listen(server: http.Server | https.Server): Promise<string> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('listening', () => {
            const addr = server.address();
            if (typeof addr === 'object' && addr) {
                resolve(`http://127.0.0.1:${addr.port}`);
            } else {
                reject(new Error('No address'));
            }
        });
    });
}

function makeFakeMcpServer(ctx: unknown) {
    return {
        workspaceManager: {
            getActiveContext: () => ctx,
        },
    } as any;
}

describe('ApiServer /healthz (P13-1)', () => {
    let savedToken: string | undefined;

    beforeAll(() => {
        savedToken = process.env.KNOWLEDGE_TOOL_TOKEN;
        process.env.KNOWLEDGE_TOOL_TOKEN = TEST_TOKEN;
    });

    afterAll(() => {
        if (savedToken === undefined) delete process.env.KNOWLEDGE_TOOL_TOKEN;
        else process.env.KNOWLEDGE_TOOL_TOKEN = savedToken;
    });

    it('returns 503 with status "pending" before the engine is ready — no auth header', async () => {
        const apiServer = new ApiServer();
        apiServer.setMcpServer(makeFakeMcpServer(undefined));
        const server = apiServer.start(0, '127.0.0.1');
        const base = await listen(server);
        try {
            const res = await fetch(`${base}/healthz`);
            expect(res.status).toBe(503);
            const body = await res.json() as any;
            expect(body.status).toBe('pending');
            expect(body.indexed).toBe(false);
        } finally {
            server.close();
        }
    });

    it('returns 200 with status "ok" once a context with an open DB exists — no auth header', async () => {
        const apiServer = new ApiServer();
        apiServer.setMcpServer(makeFakeMcpServer({
            dbManager: {},
            projectPath: '/tmp/fake-project',
        }));
        const server = apiServer.start(0, '127.0.0.1');
        const base = await listen(server);
        try {
            const res = await fetch(`${base}/healthz`);
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.status).toBe('ok');
            expect(body.indexed).toBe(true);
            expect(body.project).toBe('/tmp/fake-project');
        } finally {
            server.close();
        }
    });

    it('still enforces Bearer auth on non-healthz endpoints', async () => {
        const apiServer = new ApiServer();
        apiServer.setMcpServer(makeFakeMcpServer(undefined));
        const server = apiServer.start(0, '127.0.0.1');
        const base = await listen(server);
        try {
            const unauthorized = await fetch(`${base}/api/search/symbols`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ query: 'x' }),
            });
            expect(unauthorized.status).toBe(401);
        } finally {
            server.close();
        }
    });
});

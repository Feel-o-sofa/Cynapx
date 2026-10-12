/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * AV-1 — the liveness probe must never be throttled.
 *
 * globalLimiter (100 req/min per IP) used to count GET /healthz against the
 * same per-IP budget as API traffic. Docker/k8s health checks share the
 * instance's IP with local agent traffic, so sustained legitimate load
 * (>100 req/min) starved the probe into 429 — the Dockerfile HEALTHCHECK
 * (statusCode === 200, retries=3) would then mark a perfectly healthy
 * container unhealthy and orchestrators would restart it.
 *
 * This gate exhausts the per-IP budget and asserts that /healthz still
 * answers (200/503, never 429) while other endpoints ARE throttled.
 *
 * NOTE: globalLimiter is a module-level singleton keyed by remoteAddress, so
 * this burst test lives in its own file to avoid poisoning the budget of the
 * other api-server test files (vitest isolates state per test file).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as https from 'https';
import { ApiServer } from '../src/server/api-server';

const TEST_TOKEN = 'ratelimit-healthz-test-token';

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

describe('AV-2: client faults answer as 4xx, never 5xx', () => {
    let savedToken: string | undefined;

    beforeAll(() => {
        savedToken = process.env.KNOWLEDGE_TOOL_TOKEN;
        process.env.KNOWLEDGE_TOOL_TOKEN = TEST_TOKEN;
    });

    afterAll(() => {
        if (savedToken === undefined) delete process.env.KNOWLEDGE_TOOL_TOKEN;
        else process.env.KNOWLEDGE_TOOL_TOKEN = savedToken;
    });

    it('answers malformed JSON with 400 and an oversized body with 413', async () => {
        const apiServer = new ApiServer();
        apiServer.setMcpServer({
            workspaceManager: { getActiveContext: () => undefined },
        } as any);
        const server = apiServer.start(0, '127.0.0.1');
        const base = await listen(server);
        const headers = { 'Authorization': `Bearer ${TEST_TOKEN}`, 'Content-Type': 'application/json' };
        try {
            const malformed = await fetch(`${base}/api/symbol/get`, {
                method: 'POST', headers, body: '{"qualified_name": ',
            });
            expect(malformed.status).toBe(400);

            const oversized = await fetch(`${base}/api/symbol/get`, {
                method: 'POST', headers,
                body: JSON.stringify({ qualified_name: 'x'.repeat(1_200_000) }),
            });
            expect(oversized.status).toBe(413);
        } finally {
            server.close();
        }
    }, 30_000);
});

describe('AV-1: /healthz is exempt from the global rate limiter', () => {
    let savedToken: string | undefined;

    beforeAll(() => {
        savedToken = process.env.KNOWLEDGE_TOOL_TOKEN;
        process.env.KNOWLEDGE_TOOL_TOKEN = TEST_TOKEN;
    });

    afterAll(() => {
        if (savedToken === undefined) delete process.env.KNOWLEDGE_TOOL_TOKEN;
        else process.env.KNOWLEDGE_TOOL_TOKEN = savedToken;
    });

    it('keeps answering /healthz after the per-IP budget is exhausted, while API routes get 429', async () => {
        const apiServer = new ApiServer();
        apiServer.setMcpServer({
            workspaceManager: { getActiveContext: () => undefined },
        } as any);
        const server = apiServer.start(0, '127.0.0.1');
        const base = await listen(server);
        try {
            // Exhaust the 100 req/min per-IP budget on an API route. The
            // limiter runs before auth, so unauthenticated requests count.
            for (let i = 0; i < 105; i++) {
                await fetch(`${base}/api/symbol/get`, { method: 'POST' });
            }

            // API traffic is now throttled…
            const throttled = await fetch(`${base}/api/symbol/get`, { method: 'POST' });
            expect(throttled.status).toBe(429);

            // …but the liveness probe still answers with its real state
            // (503 pending here — never 429).
            const probe = await fetch(`${base}/healthz`);
            expect(probe.status).toBe(503);
            const body = await probe.json() as any;
            expect(body.status).toBe('pending');
        } finally {
            server.close();
        }
    }, 30_000);
});

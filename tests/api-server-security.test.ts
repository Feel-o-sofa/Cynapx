/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * Phase 13-7 — API security regression tests (A-2 / A-3), HTTP level where it
 * matters plus unit coverage for session lifecycle internals:
 *   - A-3: Bearer comparison is constant-time and returns 401 for wrong,
 *     too-short, and too-long tokens.
 *   - A-2: idle MCP sessions are evicted after the TTL; new sessions are
 *     rejected (429) once the hard cap is reached; the `sessionId` query
 *     parameter is masked in request logs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import * as https from 'https';
import {
    ApiServer,
    timingSafeEqualStr,
    maskSessionId,
    maskSessionInUrl,
} from '../src/server/api-server';

const TEST_TOKEN = 'phase13-7-secret-token';

function listen(server: http.Server | https.Server): Promise<string> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('listening', () => {
            const addr = server.address();
            if (typeof addr === 'object' && addr) resolve(`http://127.0.0.1:${addr.port}`);
            else reject(new Error('No address'));
        });
    });
}

function makeFakeMcpServer() {
    return {
        workspaceManager: { getActiveContext: () => undefined },
        createSdkServerForSession: () => ({ connect: async () => {}, close: async () => {} }),
    } as any;
}

describe('timingSafeEqualStr (A-3)', () => {
    it('returns true for identical strings', () => {
        expect(timingSafeEqualStr('Bearer abc', 'Bearer abc')).toBe(true);
    });
    it('returns false for different strings of equal length', () => {
        expect(timingSafeEqualStr('Bearer abc', 'Bearer abd')).toBe(false);
    });
    it('returns false without throwing for a shorter string', () => {
        expect(timingSafeEqualStr('x', 'Bearer abcdef')).toBe(false);
    });
    it('returns false without throwing for a longer string', () => {
        expect(timingSafeEqualStr('Bearer abcdefghijklmnop', 'Bearer abc')).toBe(false);
    });
    it('returns false for empty vs non-empty', () => {
        expect(timingSafeEqualStr('', 'Bearer abc')).toBe(false);
    });
});

describe('sessionId masking (A-2)', () => {
    it('truncates a long sessionId', () => {
        expect(maskSessionId('0123456789abcdef')).toBe('01234567***');
    });
    it('fully masks a short sessionId', () => {
        expect(maskSessionId('abc')).toBe('***');
    });
    it('masks the sessionId query param in a URL', () => {
        expect(maskSessionInUrl('/mcp?sessionId=0123456789abcdef')).toBe('/mcp?sessionId=01234567***');
    });
    it('masks sessionId regardless of position among params', () => {
        expect(maskSessionInUrl('/mcp?foo=1&sessionId=0123456789abcdef&bar=2'))
            .toBe('/mcp?foo=1&sessionId=01234567***&bar=2');
    });
    it('leaves URLs without a sessionId untouched', () => {
        expect(maskSessionInUrl('/api/search/symbols?q=foo')).toBe('/api/search/symbols?q=foo');
    });
});

describe('ApiServer Bearer auth (A-3)', () => {
    let saved: string | undefined;
    beforeAll(() => { saved = process.env.KNOWLEDGE_TOOL_TOKEN; process.env.KNOWLEDGE_TOOL_TOKEN = TEST_TOKEN; });
    afterAll(() => { if (saved === undefined) delete process.env.KNOWLEDGE_TOOL_TOKEN; else process.env.KNOWLEDGE_TOOL_TOKEN = saved; });

    async function post(base: string, auth?: string) {
        return fetch(`${base}/api/search/symbols`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
            body: JSON.stringify({ query: 'x' }),
        });
    }

    it('401 for a wrong token, missing token, too-short and too-long tokens', async () => {
        const apiServer = new ApiServer();
        apiServer.setMcpServer(makeFakeMcpServer());
        const server = apiServer.start(0, '127.0.0.1');
        const base = await listen(server);
        try {
            expect((await post(base)).status).toBe(401); // missing
            expect((await post(base, `Bearer wrong-token`)).status).toBe(401);
            expect((await post(base, `Bearer x`)).status).toBe(401); // short
            expect((await post(base, `Bearer ${TEST_TOKEN}extra-suffix-making-it-longer`)).status).toBe(401); // long
        } finally {
            apiServer.stopSessionSweeper();
            server.close();
        }
    });
});

describe('ApiServer MCP session lifecycle (A-2)', () => {
    let saved: string | undefined;
    beforeAll(() => { saved = process.env.KNOWLEDGE_TOOL_TOKEN; process.env.KNOWLEDGE_TOOL_TOKEN = TEST_TOKEN; });
    afterAll(() => { if (saved === undefined) delete process.env.KNOWLEDGE_TOOL_TOKEN; else process.env.KNOWLEDGE_TOOL_TOKEN = saved; });

    it('evicts sessions idle longer than the TTL', () => {
        const apiServer = new ApiServer() as any;
        try {
            const closed: string[] = [];
            const mkSession = (lastAccess: number) => ({
                transport: { close: () => {} },
                sdkServer: { close: async () => {} },
                lastAccess,
            });
            const now = Date.now();
            apiServer.mcpSessions.set('fresh', mkSession(now - 60_000)); // 1 min ago
            apiServer.mcpSessions.set('stale', mkSession(now - 31 * 60_000)); // 31 min ago
            apiServer.sweepIdleSessions(now);
            expect(apiServer.mcpSessions.has('fresh')).toBe(true);
            expect(apiServer.mcpSessions.has('stale')).toBe(false);
            void closed;
        } finally {
            apiServer.stopSessionSweeper();
        }
    });

    it('rejects new sessions with 429 once the cap is reached', async () => {
        const apiServer = new ApiServer() as any;
        apiServer.setMcpServer(makeFakeMcpServer());
        // Fill the map to the cap with fresh (non-evictable) sessions.
        const now = Date.now();
        for (let i = 0; i < 100; i++) {
            apiServer.mcpSessions.set(`s${i}`, {
                transport: { close: () => {} },
                sdkServer: { close: async () => {} },
                lastAccess: now,
            });
        }
        const server = apiServer.start(0, '127.0.0.1');
        const base = await listen(server);
        try {
            const res = await fetch(`${base}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
            });
            expect(res.status).toBe(429);
            const body = await res.json() as any;
            expect(body.error_code).toBe('SESSION_LIMIT_REACHED');
        } finally {
            apiServer.stopSessionSweeper();
            server.close();
        }
    });

    it('does not log a raw sessionId (logged value is masked)', async () => {
        const apiServer = new ApiServer() as any;
        apiServer.setMcpServer(makeFakeMcpServer());
        // Cap the map so the request short-circuits to 429 without needing a real
        // MCP handshake, while still passing through the request logger.
        const now = Date.now();
        for (let i = 0; i < 100; i++) {
            apiServer.mcpSessions.set(`s${i}`, { transport: { close: () => {} }, sdkServer: { close: async () => {} }, lastAccess: now });
        }
        const server = apiServer.start(0, '127.0.0.1');
        const base = await listen(server);
        const logs: string[] = [];
        const spy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => { logs.push(args.join(' ')); });
        const rawSid = 'deadbeefcafef00dsecret';
        try {
            await fetch(`${base}/mcp?sessionId=${rawSid}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_TOKEN}` },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
            });
            // Give the res 'finish' logger a tick to fire.
            await new Promise(r => setTimeout(r, 50));
            const joined = logs.join('\n');
            expect(joined).not.toContain(rawSid);
            expect(joined).toContain('sessionId=deadbeef***');
        } finally {
            spy.mockRestore();
            apiServer.stopSessionSweeper();
            server.close();
        }
    });
});

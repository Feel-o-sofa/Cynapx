/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * Phase 13-9 — REST API HTTP-level coverage (diagnostic-v10 §5 "REST API HTTP
 * 레벨" gap). Builds on P13-7's session TTL/cap + timingSafeEqualStr work and
 * exercises a real listen()'d server through `supertest`:
 *
 *   - 401 path + timing-safe Bearer comparison (A-3) for missing / wrong /
 *     short / long tokens, plus the success path through to a downstream
 *     handler.
 *   - rate-limit 429 (H-1): the analysis limiter (10 req/min) trips while the
 *     global limiter (100 req/min) does not for a single endpoint.
 *   - /mcp session lifecycle (A-2): a real POST creates a session; a GET
 *     without a valid sessionId is rejected (auth bypass guard, SEC-H-1); a
 *     GET with a known sessionId bypasses auth; idle sessions are swept; the
 *     hard cap returns 429.
 *   - /healthz status codes (P13-1 / v9 A-8) across not-ready (503), ready
 *     (200), and error (getActiveContext throws → still 503, never crashes).
 *
 * The existing fetch-based tests (api-server-security / api-server-healthz)
 * cover the basics; this file closes the remaining HTTP-level holes and uses
 * supertest as the diagnostic mandated. The token is captured by ApiServer at
 * construction time, so KNOWLEDGE_TOOL_TOKEN is set before each `new
 * ApiServer()`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import * as http from 'http';
import { ApiServer } from '../src/server/api-server';

const TEST_TOKEN = 'phase13-9-http-token';
const AUTH = `Bearer ${TEST_TOKEN}`;

// Track every server we start so a failed assertion never leaks a listener.
const openServers: http.Server[] = [];
const openApis: any[] = [];

function makeServer(mcpServer?: unknown): http.Server {
    const api = new ApiServer() as any;
    if (mcpServer) api.setMcpServer(mcpServer);
    const server = api.start(0, '127.0.0.1') as http.Server;
    openServers.push(server);
    openApis.push(api);
    return server;
}

/** A fake MCP server whose active context is configurable per test. */
function fakeMcpServer(opts: {
    ctx?: unknown;
    throwOnCtx?: boolean;
    sdk?: () => unknown;
} = {}) {
    return {
        workspaceManager: {
            getActiveContext: () => {
                if (opts.throwOnCtx) throw new Error('boom: context lookup failed');
                return opts.ctx;
            },
        },
        createSdkServerForSession: opts.sdk ?? (() => ({
            connect: async () => {},
            close: async () => {},
        })),
    } as any;
}

beforeAll(() => { process.env.KNOWLEDGE_TOOL_TOKEN = TEST_TOKEN; });
afterAll(() => { delete process.env.KNOWLEDGE_TOOL_TOKEN; });

afterEach(async () => {
    for (const api of openApis.splice(0)) {
        try { api.stopSessionSweeper(); } catch { /* ignore */ }
    }
    for (const server of openServers.splice(0)) {
        await new Promise<void>((res) => server.close(() => res()));
    }
});

// ---------------------------------------------------------------------------
// Auth: 401 + timing-safe comparison
// ---------------------------------------------------------------------------
describe('HTTP auth (A-3) — 401 + timing-safe Bearer comparison', () => {
    it('rejects missing, wrong, short and long tokens with 401', async () => {
        const server = makeServer(fakeMcpServer({ ctx: { dbManager: {} } }));
        const post = (auth?: string) => {
            const r = request(server).post('/api/search/symbols').send({ query: 'x' });
            return auth ? r.set('Authorization', auth) : r;
        };

        expect((await post()).status).toBe(401);                                  // missing
        expect((await post('Bearer wrong-token')).status).toBe(401);              // wrong, same-ish length
        expect((await post('Bearer x')).status).toBe(401);                        // far too short
        expect((await post(`${AUTH}-extra-suffix-making-it-much-longer`)).status).toBe(401); // too long
        expect((await post('NotBearer ' + TEST_TOKEN)).status).toBe(401);         // wrong scheme

        const body = (await post()).body;
        expect(body.error_code).toBe('UNAUTHORIZED');
    });

    it('accepts the correct token and reaches the downstream handler', async () => {
        // ctx with a graphEngine whose searchSymbols returns one row — proves we
        // passed auth AND validation and reached handleSymbolSearch.
        const ctx = {
            graphEngine: {
                nodeRepo: {
                    searchSymbols: () => [{
                        qualified_name: 'Foo.bar', symbol_type: 'function',
                        file_path: 'a.ts', start_line: 1, end_line: 2,
                    }],
                },
            },
        };
        const server = makeServer(fakeMcpServer({ ctx }));
        const res = await request(server)
            .post('/api/search/symbols')
            .set('Authorization', AUTH)
            .send({ query: 'Foo' });
        expect(res.status).toBe(200);
        expect(res.body.matches).toHaveLength(1);
        expect(res.body.matches[0].symbol.qualified_name).toBe('Foo.bar');
    });
});

// ---------------------------------------------------------------------------
// Rate limiting: 429
// ---------------------------------------------------------------------------
describe('HTTP rate limiting (H-1) — analysis limiter trips at 429', () => {
    it('returns 429 after the per-IP analysis budget (10/min) is exhausted', async () => {
        // hotspots is behind the stricter analyzeLimiter (max 10/min). A context
        // with a dbManager whose prepare().all() returns [] keeps each request a
        // clean 200 until the limiter trips.
        const ctx = {
            dbManager: { getDb: () => ({ prepare: () => ({ all: () => [] }) }) },
            graphEngine: { nodeRepo: { mapRowToNode: (r: any) => r } },
        };
        const server = makeServer(fakeMcpServer({ ctx }));
        const fire = () => request(server)
            .post('/api/analysis/hotspots')
            .set('Authorization', AUTH)
            .send({ metric: 'loc' });

        const statuses: number[] = [];
        for (let i = 0; i < 12; i++) statuses.push((await fire()).status);

        // First 10 are allowed (200), the rest are rate-limited (429).
        expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
        expect(statuses.slice(10).some((s) => s === 429)).toBe(true);
    });

    it('does not rate-limit a non-analysis endpoint at the same volume', async () => {
        const ctx = {
            graphEngine: { nodeRepo: { searchSymbols: () => [] } },
        };
        const server = makeServer(fakeMcpServer({ ctx }));
        // 12 search calls — under the global 100/min budget, all should pass.
        for (let i = 0; i < 12; i++) {
            const res = await request(server)
                .post('/api/search/symbols')
                .set('Authorization', AUTH)
                .send({ query: 'x' });
            expect(res.status).toBe(200);
        }
    });
});

// ---------------------------------------------------------------------------
// /mcp session creation + GET-bypass rejection + cleanup
// ---------------------------------------------------------------------------
describe('HTTP /mcp session lifecycle (A-2 / SEC-H-1)', () => {
    it('rejects GET /mcp with an UNKNOWN sessionId (no auth bypass)', async () => {
        const server = makeServer(fakeMcpServer({ ctx: undefined }));
        // No Authorization header and a sessionId the server has never issued —
        // the SEC-H-1 guard must NOT treat the unknown id as authenticated.
        const res = await request(server).get('/mcp?sessionId=never-issued-this');
        expect(res.status).toBe(401);
    });

    it('GET /mcp with a KNOWN sessionId bypasses auth (reconnection path)', async () => {
        const api = new ApiServer() as any;
        api.setMcpServer(fakeMcpServer({ ctx: undefined }));
        // Seed a known session directly so the GET-bypass branch is taken without
        // needing a full Streamable HTTP handshake. handleRequest is stubbed.
        let handled = false;
        api.mcpSessions.set('known-sid', {
            // The stub must end the HTTP response (the real transport would) so
            // supertest resolves — otherwise the request hangs.
            transport: {
                handleRequest: async (_req: any, res: any) => { handled = true; res.status(200).json({ ok: true }); },
                close: () => {},
            },
            sdkServer: { close: async () => {} },
            lastAccess: Date.now(),
        });
        const server = api.start(0, '127.0.0.1') as http.Server;
        openServers.push(server); openApis.push(api);

        const res = await request(server).get('/mcp?sessionId=known-sid');
        // The auth middleware let it through (not 401) and the request reached
        // the existing-session branch of handleMcp.
        expect(res.status).not.toBe(401);
        expect(handled).toBe(true);
    });

    it('creates a session on POST /mcp (registers session + connects SDK server once)', async () => {
        const api = new ApiServer() as any;
        let connected = 0;
        const sid = 'create-me-sid';
        api.setMcpServer(fakeMcpServer({
            ctx: undefined,
            sdk: () => ({ connect: async () => { connected++; }, close: async () => {} }),
        }));
        const server = api.start(0, '127.0.0.1') as http.Server;
        openServers.push(server); openApis.push(api);

        // handleMcp registers the session and calls sdkServer.connect() BEFORE
        // delegating to the real StreamableHTTP transport (which may not answer a
        // bare initialize without the full negotiated headers). We fire the
        // request without awaiting its body and assert on the post-create state,
        // then abort the socket so nothing leaks.
        const req = request(server)
            .post(`/mcp?sessionId=${sid}`)
            .set('Authorization', AUTH)
            .set('content-type', 'application/json')
            .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
        req.end(() => {}); // do not await the response body
        // Poll briefly for the session to appear.
        for (let i = 0; i < 50 && !api.mcpSessions.has(sid); i++) {
            await new Promise((r) => setTimeout(r, 20));
        }
        expect(api.mcpSessions.has(sid)).toBe(true);
        expect(connected).toBe(1);
        try { (req as any).abort?.(); } catch { /* ignore */ }
    });

    it('sweeps idle sessions past the TTL and closes their transport', () => {
        const api = new ApiServer() as any;
        try {
            const closed: string[] = [];
            const mk = (lastAccess: number, name: string) => ({
                transport: { close: () => closed.push(name) },
                sdkServer: { close: async () => {} },
                lastAccess,
            });
            const now = Date.now();
            api.mcpSessions.set('fresh', mk(now - 60_000, 'fresh'));
            api.mcpSessions.set('stale', mk(now - 31 * 60_000, 'stale'));
            api.sweepIdleSessions(now);
            expect(api.mcpSessions.has('fresh')).toBe(true);
            expect(api.mcpSessions.has('stale')).toBe(false);
            expect(closed).toContain('stale');
        } finally {
            api.stopSessionSweeper();
        }
    });

    it('rejects new sessions with 429 once the hard cap is reached', async () => {
        const api = new ApiServer() as any;
        api.setMcpServer(fakeMcpServer({ ctx: undefined }));
        const now = Date.now();
        for (let i = 0; i < 100; i++) {
            api.mcpSessions.set(`s${i}`, {
                transport: { close: () => {} }, sdkServer: { close: async () => {} }, lastAccess: now,
            });
        }
        const server = api.start(0, '127.0.0.1') as http.Server;
        openServers.push(server); openApis.push(api);

        const res = await request(server)
            .post('/mcp')
            .set('Authorization', AUTH)
            .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
        expect(res.status).toBe(429);
        expect(res.body.error_code).toBe('SESSION_LIMIT_REACHED');
    });
});

// ---------------------------------------------------------------------------
// /healthz across states
// ---------------------------------------------------------------------------
describe('HTTP /healthz status codes (P13-1 / v9 A-8)', () => {
    it('503 "pending" before the engine is ready — no auth header required', async () => {
        const server = makeServer(fakeMcpServer({ ctx: undefined }));
        const res = await request(server).get('/healthz');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('pending');
        expect(res.body.indexed).toBe(false);
    });

    it('200 "ok" once a context with an open DB exists — no auth header required', async () => {
        const server = makeServer(fakeMcpServer({ ctx: { dbManager: {}, projectPath: '/tmp/p' } }));
        const res = await request(server).get('/healthz');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.indexed).toBe(true);
        expect(res.body.project).toBe('/tmp/p');
    });

    it('does not crash (and reports 503) when context lookup throws', async () => {
        // The /healthz handler uses optional chaining (?.) so a throwing
        // getActiveContext must not 500 — it degrades to "pending".
        const server = makeServer(fakeMcpServer({ throwOnCtx: true }));
        const res = await request(server).get('/healthz');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('pending');
    });
});

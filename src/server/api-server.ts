/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import express from 'express';
import { Request, Response } from 'express';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { z, ZodSchema } from 'zod';
import swaggerUi from 'swagger-ui-express';
// P14-1 (N-1): the HTTP surface here is our own express@4 app (see `express`
// import above) wired to the SDK's transport-agnostic Server via
// StreamableHTTPServerTransport / Stdio. The SDK ALSO ships a hono + express@5
// based reference server (`@hono/node-server`, hono, express@5) which carries
// several MODERATE advisories — but Cynapx never imports or loads that server,
// so those transitive packages are unreachable at runtime. They are pinned to
// patched versions via package.json `overrides` (fast-uri/qs) where a fix
// exists; hono is overridden to a patched line as well. Upstream tracking:
// modelcontextprotocol/typescript-sdk#2042. Do not switch to the SDK's
// hono/express@5 server without re-running the audit gate.
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Server as SdkMcpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { TraversalResult } from '../graph/graph-engine';
import { CodeNode, CodeEdge } from '../types';
import { McpServer } from './mcp-server';
import { EngineContext } from './workspace-manager';
import { openApiSpec } from './openapi';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getCentralStorageDir } from '../utils/paths';
import { getVersion } from '../utils/version';
import { Logger } from '../utils/logger';

const log = new Logger('API');

// O-12: redact sensitive fields before logging request payloads.
// L4: standalone `auth` keys (underscore-delimited, so `author` is NOT
// redacted) plus passwd/credential/cookie/session variants.
const SENSITIVE_FIELD_PATTERN = /(^|_)auth($|_)|token|secret|passwd|password|apikey|api_key|authorization|credential|cookie|session/i;

// Exported for direct testing (M5/O-12).
export function redactSensitiveFields(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(redactSensitiveFields);
    }
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            result[key] = SENSITIVE_FIELD_PATTERN.test(key) ? '[REDACTED]' : redactSensitiveFields(val);
        }
        return result;
    }
    return value;
}

// A-3: constant-time string comparison. Hashes both inputs to a fixed-length
// SHA-256 digest so crypto.timingSafeEqual never sees mismatched buffer lengths
// (it throws otherwise) and no early length check leaks timing information.
// Exported for direct unit testing.
export function timingSafeEqualStr(a: string, b: string): boolean {
    const da = crypto.createHash('sha256').update(a, 'utf8').digest();
    const db = crypto.createHash('sha256').update(b, 'utf8').digest();
    return crypto.timingSafeEqual(da, db);
}

// --- Zod Schemas (M-4) ---
const SymbolRefSchema = z.object({
    qualified_name: z.string().min(1),
});

const GetSymbolSchema = z.object({
    qualified_name: z.string().min(1),
});

const GetCallersSchema = z.object({
    symbol: SymbolRefSchema,
    max_depth: z.number().int().positive().optional(),
});

const GetCalleesSchema = z.object({
    symbol: SymbolRefSchema,
    max_depth: z.number().int().positive().optional(),
});

const ImpactAnalysisSchema = z.object({
    symbol: SymbolRefSchema,
    max_depth: z.number().int().positive().optional(),
});

const HotspotsSchema = z.object({
    metric: z.enum(['loc', 'cyclomatic', 'fan_in', 'fan_out', 'fan_in_dynamic', 'fan_out_dynamic']),
    threshold: z.number().optional(),
    symbol_type: z.string().optional(),
});

const TestsSchema = z.object({
    symbol: SymbolRefSchema,
});

const SymbolSearchSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
});

const ExportGraphSchema = z.object({
    root_qname: z.string().optional(),
    max_depth: z.number().int().positive().optional(),
});

// --- Validation helper (M-4) ---
function validate<T>(schema: ZodSchema<T>, req: Request, res: Response): T | null {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: 'Validation failed', details: result.error.issues });
        return null;
    }
    return result.data;
}

// --- Rate limiters (SEC-M-1: keyGenerator fixed to socket remoteAddress to prevent X-Forwarded-For spoofing) ---
const globalLimiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    keyGenerator: (req) => req.socket.remoteAddress ?? 'unknown',
});
const analyzeLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    keyGenerator: (req) => req.socket.remoteAddress ?? 'unknown',
});

interface McpSession {
    transport: StreamableHTTPServerTransport;
    sdkServer: SdkMcpServer;
    // A-2: last time this session was touched (ms epoch) — drives idle eviction.
    lastAccess: number;
}

// A-2: idle TTL and hard cap for the MCP session map. Without these the map
// grew unbounded (a session is only removed on transport.onclose), so an
// authenticated client sending fresh `mcp-session-id` headers could exhaust
// memory. Sessions idle longer than the TTL are swept; once the cap is hit new
// sessions are rejected.
const MCP_SESSION_IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MCP_SESSION_MAX = 100;
const MCP_SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// A-2: mask a sessionId for logging — keep only a short prefix so logs remain
// correlatable without persisting the full credential-equivalent value.
// Exported for direct unit testing.
export function maskSessionId(id: string): string {
    if (!id) return id;
    return id.length <= 8 ? '***' : `${id.slice(0, 8)}***`;
}

// A-2: redact the `sessionId` query parameter out of a request URL before
// logging. The sessionId doubles as a bearer-equivalent for GET /mcp reconnects
// (see SEC-H-1), so it must not be written to log aggregators.
// Exported for direct unit testing.
export function maskSessionInUrl(url: string): string {
    return url.replace(/([?&]sessionId=)([^&]+)/gi, (_m, p1, val) => `${p1}${maskSessionId(decodeURIComponent(val))}`);
}

export class ApiServer {
    private app: express.Application;
    private mcpServer?: McpServer;
    private mcpSessions: Map<string, McpSession> = new Map();
    // A-2: periodic idle-session sweeper (mirrors HealthMonitor's setInterval
    // pattern). unref()'d so it never keeps the process alive on its own.
    private sessionSweeper?: NodeJS.Timeout;

    constructor(private httpsOptions?: https.ServerOptions) {
        this.app = express();
        this.app.use(express.json({ limit: '1mb' }));
        // H-1: apply global rate limiter (100 req/min per IP)
        this.app.use(globalLimiter);
        this.setupMiddleware();
        this.setupRoutes();
        this.startSessionSweeper();
    }

    // A-2: evict MCP sessions idle longer than the TTL. Runs on a timer and is
    // also invoked lazily from handleMcp() so eviction happens even if the timer
    // is unref()'d and the loop is otherwise idle.
    private sweepIdleSessions(now: number = Date.now()): void {
        for (const [sid, session] of this.mcpSessions) {
            if (now - session.lastAccess > MCP_SESSION_IDLE_TTL_MS) {
                this.mcpSessions.delete(sid);
                try { session.transport.close?.(); } catch { /* ignore */ }
                session.sdkServer.close().catch(() => {});
            }
        }
    }

    private startSessionSweeper(): void {
        this.sessionSweeper = setInterval(() => this.sweepIdleSessions(), MCP_SESSION_SWEEP_INTERVAL_MS);
        this.sessionSweeper.unref?.();
    }

    // Stop the sweeper — used by tests and graceful shutdown.
    public stopSessionSweeper(): void {
        if (this.sessionSweeper) {
            clearInterval(this.sessionSweeper);
            this.sessionSweeper = undefined;
        }
    }

    private setupMiddleware(): void {
        const envToken = process.env.KNOWLEDGE_TOOL_TOKEN;
        let AUTH_TOKEN: string;
        if (envToken) {
            AUTH_TOKEN = envToken;
        } else {
            const generatedToken = crypto.randomBytes(32).toString('hex');
            AUTH_TOKEN = generatedToken;

            // Persist the generated token to a file (not stderr) so it isn't
            // captured by log aggregators. Permissions restrict it to the owner.
            const tokenFile = path.join(getCentralStorageDir(), 'api-token');
            try {
                fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
                fs.writeFileSync(tokenFile, generatedToken, { encoding: 'utf8', mode: 0o600 });
                log.warn('No KNOWLEDGE_TOOL_TOKEN set — generated a temporary token', { tokenFile });
            } catch (err) {
                log.warn('No KNOWLEDGE_TOOL_TOKEN set — failed to persist generated token', { detail: String(err) });
            }
        }
        
        // Advanced Request Logger Restoration
        this.app.use((req, res, next) => {
            const start = Date.now();
            const { method, url, body } = req;
            const remoteAddr = req.ip || req.socket.remoteAddress;

            res.on('finish', () => {
                const duration = Date.now() - start;
                const status = res.statusCode;
                // A-2: mask the sessionId query param so it never lands in logs.
                log.info('request', { method, url: maskSessionInUrl(url), remoteAddr, status, durationMs: duration });
                if (method === 'POST' && body && Object.keys(body).length > 0) {
                    if (process.env.CYNAPX_LOG_PAYLOADS === '1') {
                        log.debug('request payload', { payload: JSON.stringify(redactSensitiveFields(body)).substring(0, 200) });
                    }
                }
            });
            next();
        });

        this.app.use((req, res, next) => {
            if (req.path.startsWith('/api/docs')) return next();
            // P13-1 (C-1/v9 A-8): /healthz is a liveness probe for Docker/k8s —
            // it must be reachable without a Bearer token (it exposes no
            // project data beyond readiness/version).
            if (req.path === '/healthz' && req.method === 'GET') return next();
            if (req.path === '/mcp' && req.method === 'GET') {
                // Allow if no-auth mode, or if a valid (known) sessionId is present
                // (MCP Streamable HTTP uses sessionId for reconnection)
                // SEC-H-1: validate sessionId against known sessions to prevent auth bypass
                const sessionId = req.query['sessionId'] as string | undefined;
                if (!AUTH_TOKEN || (sessionId && this.mcpSessions.has(sessionId))) return next();
                // Otherwise fall through to auth check below
            }
            const authHeader = req.headers.authorization;
            // A-3: constant-time Bearer comparison. We SHA-256 both the provided
            // header and the expected value, then timingSafeEqual on the fixed-
            // length (32-byte) digests. Hashing avoids timingSafeEqual throwing on
            // length mismatch and avoids a length-based early exit leaking the
            // token length via timing.
            if (!authHeader || !timingSafeEqualStr(authHeader, `Bearer ${AUTH_TOKEN}`)) {
                return res.status(401).json({ error_code: 'UNAUTHORIZED', message: 'Invalid or missing Bearer Token' });
            }
            next();
        });
    }

    public setMcpServer(mcpServer: McpServer): void {
        this.mcpServer = mcpServer;
    }

    private getActiveContext(): EngineContext {
        if (!this.mcpServer) throw new Error("MCP Server not attached");
        const ctx = this.mcpServer.workspaceManager.getActiveContext();
        if (!ctx) throw new Error("No active project context");
        return ctx;
    }

    private setupRoutes(): void {
        // P10-L-4: Health check endpoint — no auth required, used by Docker/k8s probes
        this.app.get('/healthz', (req: Request, res: Response) => {
            // P13-9: a liveness probe must never 500 — if the workspace lookup
            // throws transiently (e.g. mid-failover), degrade to "pending" (503)
            // rather than letting the error bubble to the 500 handler, which
            // would make orchestrators flap the instance unnecessarily.
            let ctx: EngineContext | null | undefined;
            try {
                ctx = this.mcpServer?.workspaceManager?.getActiveContext?.();
            } catch {
                ctx = undefined;
            }
            const dbOk = !!(ctx?.dbManager);
            // v9 A-8 잔존 (P13-1): report 503 while the engine is still pending
            // so orchestrators don't route traffic to a not-yet-ready instance.
            res.status(dbOk ? 200 : 503).json({
                status: dbOk ? 'ok' : 'pending',
                version: getVersion(),
                indexed: dbOk,
                project: ctx?.projectPath ?? null,
                uptime: Math.floor(process.uptime()),
                timestamp: new Date().toISOString()
            });
        });

        // SEC-M-2: Swagger UI exposed only in non-production environments
        if (process.env['NODE_ENV'] !== 'production') {
            this.app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
        }

        this.app.all('/mcp', this.handleMcp.bind(this));
        this.app.post('/api/symbol/get', this.handleGetSymbol.bind(this));
        this.app.post('/api/graph/callers', this.handleGetCallers.bind(this));
        this.app.post('/api/graph/callees', this.handleGetCallees.bind(this));
        // H-1: stricter limiter (10 req/min) for heavy analysis endpoints
        this.app.post('/api/analysis/impact', analyzeLimiter, this.handleImpactAnalysis.bind(this));
        this.app.post('/api/analysis/hotspots', analyzeLimiter, this.handleHotspots.bind(this));
        this.app.post('/api/analysis/tests', analyzeLimiter, this.handleTests.bind(this));
        this.app.post('/api/search/symbols', this.handleSymbolSearch.bind(this));
        this.app.post('/api/graph/export', this.handleExportGraph.bind(this));

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        this.app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
            log.error('Unhandled error', { detail: err?.message ?? String(err) });
            if (!res.headersSent) {
                res.status(500).json({ error_code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
            }
        });
    }

    private async handleMcp(req: Request, res: Response) {
        if (!this.mcpServer) return res.status(503).json({ error: "MCP Server not initialized" });

        // A-2: opportunistically evict idle sessions on every /mcp request.
        const now = Date.now();
        this.sweepIdleSessions(now);

        const querySid = req.query.sessionId as string;
        const headerSid = req.headers['mcp-session-id'] as string;
        const sessionId = querySid || headerSid || crypto.randomUUID();

        const existing = this.mcpSessions.get(sessionId);
        if (existing) {
            existing.lastAccess = now; // A-2: refresh idle timer on access
            await existing.transport.handleRequest(req, res, req.body);
            return;
        }

        // A-2: enforce the hard cap. After sweeping idle sessions, if we are
        // still at the limit, reject new session creation rather than growing
        // unbounded. 429 (rather than 503) signals a retriable capacity limit.
        if (this.mcpSessions.size >= MCP_SESSION_MAX) {
            return res.status(429).json({
                error_code: 'SESSION_LIMIT_REACHED',
                message: 'Maximum number of concurrent MCP sessions reached. Retry later.'
            });
        }

        // H-1: create a fresh SdkMcpServer per session — SDK only allows connect() once per instance
        // M-4: track both transport and sdkServer together; clean up both on session end
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
        const sdkServer = this.mcpServer.createSdkServerForSession();
        const session: McpSession = { transport, sdkServer, lastAccess: now };
        this.mcpSessions.set(sessionId, session);

        transport.onclose = () => {
            this.mcpSessions.delete(sessionId);
            sdkServer.close().catch(() => {});
        };

        await sdkServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }

    private async handleExportGraph(req: Request, res: Response) {
        const body = validate(ExportGraphSchema, req, res);
        if (body === null) return;
        try {
            const ctx = this.getActiveContext();
            const { root_qname, max_depth } = body;
            const result = await ctx.graphEngine!.exportToMermaid({ rootQName: root_qname, maxDepth: max_depth });
            res.json({ format: 'mermaid', content: result });
        } catch (e: any) {
            res.status(500).json({ error_code: 'EXPORT_FAILED', message: e.message });
        }
    }

    private handleGetSymbol(req: Request, res: Response) {
        const body = validate(GetSymbolSchema, req, res);
        if (body === null) return;
        try {
            const ctx = this.getActiveContext();
            const { qualified_name } = body;
            const node = ctx.graphEngine!.getNodeByQualifiedName(qualified_name);
            if (!node || node.id === undefined) return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND', related_symbol: qualified_name });

            const outgoing = ctx.graphEngine!.getOutgoingEdges(node.id);
            const incoming = ctx.graphEngine!.getIncomingEdges(node.id);

            res.json({ 
                node: this.mapToGraphNode(node),
                outgoing_edges: outgoing.map(e => this.mapToGraphEdge(ctx, e)),
                incoming_edges: incoming.map(e => this.mapToGraphEdge(ctx, e))
            });
        } catch (e: any) {
            res.status(500).json({ error_code: 'INTERNAL_ERROR', message: e.message });
        }
    }

    // Restoration: Sophisticated Path Formatting with Line Info
    private formatPath(ctx: EngineContext, path: any[], direction: 'incoming' | 'outgoing'): string[] {
        const steps = direction === 'incoming' ? [...path].reverse() : path;
        return steps.map((step, index) => {
            const node = ctx.graphEngine!.getNodeById(step.nodeId);
            const qname = node ? node.qualified_name : 'unknown';
            if (index < steps.length - 1) {
                const edge = direction === 'incoming' ? step.edge : steps[index + 1].edge;
                const lineInfo = edge?.call_site_line ? ` (line ${edge.call_site_line})` : '';
                return `${qname}${lineInfo}`;
            }
            return qname;
        });
    }

    private handleGetCallers(req: Request, res: Response) {
        const body = validate(GetCallersSchema, req, res);
        if (body === null) return;
        try {
            const ctx = this.getActiveContext();
            const { symbol, max_depth } = body;
            const node = ctx.graphEngine!.getNodeByQualifiedName(symbol.qualified_name);
            if (!node || node.id === undefined) return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND' });
            const results = ctx.graphEngine!.traverse(node.id, 'BFS', { direction: 'incoming', maxDepth: max_depth || 1 });
            res.json({
                root: this.mapToGraphNode(node),
                callers: results.filter(r => r.node.id !== node.id).map(r => ({ 
                    node: this.mapToGraphNode(r.node), 
                    distance: r.distance, 
                    path: this.formatPath(ctx, r.path, 'incoming') 
                }))
            });
        } catch (e: any) {
            res.status(500).json({ error_code: 'INTERNAL_ERROR', message: e.message });
        }
    }

    private handleGetCallees(req: Request, res: Response) {
        const body = validate(GetCalleesSchema, req, res);
        if (body === null) return;
        try {
            const ctx = this.getActiveContext();
            const { symbol, max_depth } = body;
            const node = ctx.graphEngine!.getNodeByQualifiedName(symbol.qualified_name);
            if (!node || node.id === undefined) return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND' });
            const results = ctx.graphEngine!.traverse(node.id, 'BFS', { direction: 'outgoing', maxDepth: max_depth || 1 });
            res.json({
                root: this.mapToGraphNode(node),
                callees: results.filter(r => r.node.id !== node.id).map(r => ({ 
                    node: this.mapToGraphNode(r.node), 
                    distance: r.distance, 
                    path: this.formatPath(ctx, r.path, 'outgoing') 
                }))
            });
        } catch (e: any) {
            res.status(500).json({ error_code: 'INTERNAL_ERROR', message: e.message });
        }
    }

    private handleImpactAnalysis(req: Request, res: Response) {
        const body = validate(ImpactAnalysisSchema, req, res);
        if (body === null) return;
        try {
            const ctx = this.getActiveContext();
            const { symbol, max_depth } = body;
            const node = ctx.graphEngine!.getNodeByQualifiedName(symbol.qualified_name);
            if (!node || node.id === undefined) return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND' });
            const results = ctx.graphEngine!.traverse(node.id, 'BFS', { direction: 'incoming', maxDepth: max_depth || 3 });
            res.json({ 
                affected_nodes: results.map(r => ({ 
                    node: this.mapToGraphNode(r.node), 
                    distance: r.distance, 
                    impact_path: this.formatPath(ctx, r.path, 'incoming') 
                })) 
            });
        } catch (e: any) {
            res.status(500).json({ error_code: 'INTERNAL_ERROR', message: e.message });
        }
    }

    private handleHotspots(req: Request, res: Response) {
        const body = validate(HotspotsSchema, req, res);
        if (body === null) return;
        try {
            const ctx = this.getActiveContext();
            const { metric, threshold, symbol_type } = body;
            const db = ctx.dbManager!.getDb();

            const params: any[] = [threshold || 0];
            let typeFilter = '';
            if (symbol_type) {
                typeFilter = 'AND symbol_type = ?';
                params.push(symbol_type);
            }

            // L-1: explicit column list — no SELECT *; include the requested metric column if not already in base set
            const baseColumns = 'qualified_name, symbol_type, file_path, start_line, end_line, loc, cyclomatic, fan_in, fan_out';
            const baseSet = new Set(['loc', 'cyclomatic', 'fan_in', 'fan_out']);
            const selectColumns = baseSet.has(metric) ? baseColumns : `${baseColumns}, ${metric}`;
            const hotspots = db.prepare(
                `SELECT ${selectColumns} FROM nodes WHERE ${metric} >= ? ${typeFilter} ORDER BY ${metric} DESC LIMIT 100`
            ).all(...params);
            res.json({ hotspots: hotspots.map((h: any) => ({ node: this.mapToGraphNode(ctx.graphEngine!.nodeRepo.mapRowToNode(h)), metric_value: h[metric] })) });
        } catch (e: any) {
            res.status(500).json({ error_code: 'INTERNAL_ERROR', message: e.message });
        }
    }

    private handleTests(req: Request, res: Response) {
        const body = validate(TestsSchema, req, res);
        if (body === null) return;
        try {
            const ctx = this.getActiveContext();
            const { symbol } = body;
            const node = ctx.graphEngine!.getNodeByQualifiedName(symbol.qualified_name);
            if (!node || node.id === undefined) return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND' });
            const edges = ctx.graphEngine!.getIncomingEdges(node.id);
            const tests = edges
                .map(e => ctx.graphEngine!.getNodeById(e.from_id))
                .filter(n => n && (n.file_path.includes('test') || n.file_path.includes('spec')))
                .map(n => this.mapToGraphNode(n!));
            res.json({ production_node: this.mapToGraphNode(node), tests });
        } catch (e: any) {
            res.status(500).json({ error_code: 'INTERNAL_ERROR', message: e.message });
        }
    }

    private handleSymbolSearch(req: Request, res: Response) {
        const body = validate(SymbolSearchSchema, req, res);
        if (body === null) return;
        try {
            const ctx = this.getActiveContext();
            const { query, limit } = body;
            
            const nodes = ctx.graphEngine!.nodeRepo.searchSymbols(query, limit || 20);
            res.json({ 
                matches: nodes.map(n => ({ 
                    symbol: { qualified_name: n.qualified_name, symbol_type: n.symbol_type }, 
                    location: { file_path: n.file_path, start_line: n.start_line, end_line: n.end_line } 
                })) 
            });
        } catch (e: any) {
            res.status(500).json({ error_code: 'INTERNAL_ERROR', message: e.message });
        }
    }

    private mapToGraphNode(node: CodeNode) {
        return { 
            id: node.id?.toString(), 
            symbol: { qualified_name: node.qualified_name, symbol_type: node.symbol_type }, 
            location: { file_path: node.file_path, start_line: node.start_line, end_line: node.end_line },
            metrics: { loc: node.loc, cyclomatic: node.cyclomatic, fan_in: node.fan_in, fan_out: node.fan_out },
            last_updated_commit: node.last_updated_commit
        };
    }

    // Restoration: Edge mapping with location info
    private mapToGraphEdge(ctx: EngineContext, edge: CodeEdge) {
        return {
            from: ctx.graphEngine!.getNodeById(edge.from_id)?.qualified_name,
            to: ctx.graphEngine!.getNodeById(edge.to_id)?.qualified_name,
            type: edge.edge_type,
            line: edge.call_site_line
        };
    }

    // P13-1: returns the server handle so callers (and tests) can close it.
    public start(port: number = 3000, bindAddress: string = '127.0.0.1'): http.Server | https.Server {
        const server = this.httpsOptions ? https.createServer(this.httpsOptions, this.app) : http.createServer(this.app);
        server.listen(port, bindAddress, () => {
            const protocol = this.httpsOptions ? 'HTTPS' : 'HTTP';
            log.info('API server listening', { bindAddress, port, protocol });
            // SEC-M-3: store port file in central storage dir (~/.cynapx/) instead of cwd to avoid git exposure
            try {
                const portFile = path.join(getCentralStorageDir(), 'api-server.port');
                const addr = server.address();
                const actualPort = typeof addr === 'object' && addr ? addr.port : port;
                fs.writeFileSync(portFile, String(actualPort), { mode: 0o600 });
            } catch(e) {}
        });
        return server;
    }
}

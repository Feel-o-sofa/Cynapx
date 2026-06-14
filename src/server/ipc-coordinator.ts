/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as net from 'net';
import * as readline from 'readline';
import * as crypto from 'crypto';
import { McpServer } from './mcp-server';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';


const log = new Logger('IPC');
export interface IpcRequest {
    id: string;
    method: 'executeTool';
    params: {
        name: string;
        args: any;
    };
}

export interface IpcResponse {
    id: string;
    result?: any;
    error?: string;
}

const MAX_MSG_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * A-12: per-tool IPC timeouts. A single global 30s timeout is wrong for both
 * ends of the latency spectrum: quick metadata reads should fail fast if the
 * Host is wedged, while whole-project operations (initial index, re-tag,
 * history backfill, consistency repair, clustering) legitimately run for
 * minutes on a large repo and must not be aborted prematurely.
 *
 * Values are deliberately generous on the long-running side — the Host keepalive
 * ping (below) keeps the connection alive across the gap, and the operations are
 * bounded by their own internal limits. Tools not listed use DEFAULT_IPC_TIMEOUT_MS.
 *
 * NOTE (A-4 / Phase 14-5): minimal MCP `notifications/progress` emission is now
 * wired for the long-running tools (initialize_project, backfill_history,
 * re_tag_project, check_consistency) — see src/server/tools/_progress.ts. When a
 * caller supplies a `_meta.progressToken`, the Host MCP session streams coarse
 * progress at stage boundaries via the request-scoped sendNotification; without a
 * token nothing is emitted (spec compliance).
 *
 * Relaying that progress across THIS Host↔Terminal IPC boundary is intentionally
 * NOT done (A-4(2)): the framing here is strict request/response correlated by
 * `id`, and interleaving out-of-band progress lines would require a demux +
 * back-correlation into the Terminal's MCP request context — meaningful added
 * complexity in a security-sensitive layer. The keepalive ping (above) already
 * keeps Terminal-forwarded long calls connected, so Terminal-mode tools simply
 * report no progress. Full task lifecycle (SEP-1686: streamed progress +
 * cancellation/resumption) and IPC progress relay remain documented future
 * directions for a later SDK-1.29-based phase.
 */
const DEFAULT_IPC_TIMEOUT_MS = 30_000;
const IPC_TOOL_TIMEOUTS_MS: Record<string, number> = {
    // Whole-project, potentially multi-minute operations.
    initialize_project: 30 * 60_000, // full index of a fresh repo
    re_tag_project: 15 * 60_000,
    backfill_history: 30 * 60_000,   // walks git history
    check_consistency: 15 * 60_000,  // full FS/DB/git reconciliation (+ repair)
    purge_index: 5 * 60_000,
    export_graph: 5 * 60_000,        // can serialise a large graph
    // Embedding-heavy / analysis tools that may invoke the ML sidecar.
    discover_latent_policies: 5 * 60_000,
    propose_refactor: 3 * 60_000,
    analyze_impact: 2 * 60_000,
    // Everything else (quick metadata reads: search_symbols, get_callers, …)
    // falls back to DEFAULT_IPC_TIMEOUT_MS.
};

/** A-12: resolves the IPC timeout for a tool name. */
export function getIpcTimeoutMs(toolName: string): number {
    return IPC_TOOL_TIMEOUTS_MS[toolName] ?? DEFAULT_IPC_TIMEOUT_MS;
}

/**
 * A-12: Host -> Terminal keepalive ping interval. Sent on otherwise idle
 * connections so a long-running tool call (which may produce no traffic for
 * minutes) does not get reaped by an OS/intermediary idle timeout. The Terminal
 * ignores ping lines (they carry no `id`). Overridable via env for tests.
 */
const IPC_KEEPALIVE_INTERVAL_MS = (() => {
    const v = Number(process.env.CYNAPX_IPC_KEEPALIVE_MS);
    return Number.isFinite(v) && v > 0 ? v : 15_000;
})();

/**
 * C-3 (diagnostic-v10): computes the authentication response for the IPC
 * challenge-response handshake. The shared secret (the lock-file nonce) is
 * never sent on the wire in either direction — the Host sends a random
 * one-time challenge and the Terminal proves knowledge of the nonce by
 * returning HMAC-SHA256(key = nonce, msg = challenge).
 */
export function computeAuthResponse(nonce: string, challenge: string): string {
    return crypto.createHmac('sha256', nonce).update(challenge).digest('hex');
}

/**
 * Coordinates communication between Host and Terminal sessions.
 */
export class IpcCoordinator extends EventEmitter {
    private server: net.Server | null = null;
    private client: net.Socket | null = null;
    private mcpServer: McpServer | null = null;
    private pendingRequests = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();

    constructor(mcpServer?: McpServer) {
        super();
        this.mcpServer = mcpServer || null;
    }

    public setMcpServer(mcpServer: McpServer) {
        this.mcpServer = mcpServer;
    }

    /**
     * Starts as a Host (IPC Server).
     * @param nonce - Session nonce stored in lock file; used for challenge-response auth.
     */
    public async startHost(nonce: string): Promise<number> {
        this.close();
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                socket.on('error', (err) => {
                    // Ignore common disconnect errors
                    log.error('[IPC Host] Socket error:', { detail: err.message });
                });

                // SEC-H-3 / H-8 (diagnostic-v10): enforce the 1 MB limit per
                // MESSAGE (line), not cumulatively over the socket lifetime —
                // long-lived Terminal sessions legitimately exceed 1 MB of
                // total traffic. Only the current (unterminated) line buffer
                // and each completed line are checked.
                let currentLineBytes = 0;
                socket.on('data', (chunk) => {
                    let start = 0;
                    while (start <= chunk.length) {
                        const nl = chunk.indexOf(0x0a, start); // '\n'
                        if (nl === -1) {
                            currentLineBytes += chunk.length - start;
                            break;
                        }
                        currentLineBytes += nl - start;
                        if (currentLineBytes > MAX_MSG_BYTES) {
                            socket.destroy(new Error('IPC message size limit exceeded'));
                            return;
                        }
                        currentLineBytes = 0; // message boundary — reset counter
                        start = nl + 1;
                    }
                    if (currentLineBytes > MAX_MSG_BYTES) {
                        socket.destroy(new Error('IPC message size limit exceeded'));
                    }
                });

                // SEC-C-1 / C-3 (diagnostic-v10): send a random ONE-TIME
                // challenge (unrelated to the nonce). The nonce itself must
                // never travel on the wire — any local user can connect to
                // this 127.0.0.1 port.
                const challenge = crypto.randomBytes(32).toString('hex');
                const expectedAuth = computeAuthResponse(nonce, challenge);
                socket.write(JSON.stringify({ challenge }) + '\n');

                let authenticated = false;

                // A-12: keepalive ping on idle connections. A long-running tool
                // call can leave the socket silent for minutes; periodic pings
                // keep it from being reaped. The interval is unref()'d so it
                // never holds the process open, and cleared on close/error.
                const keepalive = setInterval(() => {
                    if (!authenticated) return;
                    try {
                        socket.write(JSON.stringify({ ping: true, ts: Date.now() }) + '\n');
                    } catch {
                        clearInterval(keepalive);
                    }
                }, IPC_KEEPALIVE_INTERVAL_MS);
                if (typeof keepalive.unref === 'function') keepalive.unref();
                socket.on('close', () => clearInterval(keepalive));
                socket.on('error', () => clearInterval(keepalive));

                const rl = readline.createInterface({ input: socket });
                rl.on('error', (err) => {
                    log.error('[IPC Host] Readline error:', { detail: err.message });
                });
                rl.on('line', async (line) => {
                    try {
                        // SEC-C-1 / C-3: if not yet authenticated, expect an
                        // HMAC-SHA256(key=nonce, msg=challenge) response first.
                        if (!authenticated) {
                            const msg: { auth?: string } = JSON.parse(line);
                            const provided = typeof msg.auth === 'string' ? Buffer.from(msg.auth) : Buffer.alloc(0);
                            const expected = Buffer.from(expectedAuth);
                            const valid = provided.length === expected.length
                                && crypto.timingSafeEqual(provided, expected);
                            if (!valid) {
                                log.error('[IPC Host] Authentication failed — closing socket.');
                                socket.destroy();
                                return;
                            }
                            authenticated = true;
                            return;
                        }

                        const req: IpcRequest = JSON.parse(line);
                        if (req.method === 'executeTool' && this.mcpServer) {
                            try {
                                const result = await this.mcpServer.executeTool(req.params.name, req.params.args);
                                socket.write(JSON.stringify({ id: req.id, result }) + '\n');
                            } catch (err: unknown) {
                                const message = err instanceof Error ? err.message : String(err);
                                socket.write(JSON.stringify({ id: req.id, error: message }) + '\n');
                            }
                        }
                    } catch (err) {
                        log.error('[IPC Host] Failed to process line:', { detail: err });
                    }
                });
            });

            this.server.on('error', reject);
            this.server.listen(0, '127.0.0.1', () => {
                const port = (this.server!.address() as net.AddressInfo).port;
                log.error(`[IPC Host] Server listening on port ${port}`);
                resolve(port);
            });
        });
    }

    /**
     * Starts as a Terminal (IPC Client).
     * @param port - Host IPC port to connect to.
     * @param nonce - Session nonce read from lock file; used to respond to challenge.
     */
    public async connectToHost(port: number, nonce: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client = net.createConnection({ port, host: '127.0.0.1' });

            this.client.on('error', (err) => {
                log.error('[IPC Terminal] Connection error:', { detail: err });
                reject(err);
            });

            this.client.on('close', () => {
                log.error('[IPC Terminal] Connection closed.');
                // A-9: reject any in-flight requests so callers don't hang forever.
                for (const pending of this.pendingRequests.values()) {
                    pending.reject(new Error('IPC connection closed'));
                }
                this.pendingRequests.clear();
                this.emit('disconnected');
            });

            let authResolved = false;
            const rl = readline.createInterface({ input: this.client });
            rl.on('error', (err) => {
                log.error('[IPC Terminal] Readline error:', { detail: err.message });
            });
            rl.on('line', (line) => {
                try {
                    // SEC-C-1 / C-3: first message from Host is a random
                    // one-time challenge; prove knowledge of the lock-file
                    // nonce with HMAC-SHA256(key=nonce, msg=challenge).
                    // The nonce itself is never written to the socket.
                    if (!authResolved) {
                        const msg: { challenge?: string } = JSON.parse(line);
                        if (typeof msg.challenge !== 'string') {
                            const err = new Error('[IPC Terminal] Expected challenge from Host but got unexpected message.');
                            reject(err);
                            this.client?.destroy();
                            return;
                        }
                        this.client!.write(JSON.stringify({ auth: computeAuthResponse(nonce, msg.challenge) }) + '\n');
                        authResolved = true;
                        log.error(`[IPC Terminal] Connected to Host on port ${port}`);
                        resolve();
                        return;
                    }

                    const parsed = JSON.parse(line);
                    // A-12: keepalive pings from the Host carry no `id` — ignore.
                    if (parsed && parsed.ping === true) return;
                    const res: IpcResponse = parsed;
                    const pending = this.pendingRequests.get(res.id);
                    if (pending) {
                        if (res.error) {
                            pending.reject(new Error(res.error));
                        } else {
                            pending.resolve(res.result);
                        }
                        this.pendingRequests.delete(res.id);
                    }
                } catch (err) {
                    log.error('[IPC Terminal] Failed to process line:', { detail: err });
                }
            });
        });
    }

    /**
     * Forwards a tool execution request to the Host.
     */
    public async forwardExecuteTool(name: string, args: any): Promise<any> {
        if (!this.client) throw new Error('Not connected to Host');

        const id = crypto.randomUUID();
        const req: IpcRequest = {
            id,
            method: 'executeTool',
            params: { name, args }
        };

        const timeoutMs = getIpcTimeoutMs(name);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`IPC request '${name}' timed out after ${Math.round(timeoutMs / 1000)}s`));
            }, timeoutMs);

            this.pendingRequests.set(id, {
                resolve: (v: any) => { clearTimeout(timeout); resolve(v); },
                reject: (e: any) => { clearTimeout(timeout); reject(e); }
            });
            this.client!.write(JSON.stringify(req) + '\n');
        });
    }

    public close() {
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
            pending.reject(new Error('IPC connection closed'));
        }
        this.pendingRequests.clear();

        if (this.server) {
            this.server.close();
            this.server = null;
        }
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }
    }
}

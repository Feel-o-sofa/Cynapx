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
                    console.error('[IPC Host] Socket error:', err.message);
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

                const rl = readline.createInterface({ input: socket });
                rl.on('error', (err) => {
                    console.error('[IPC Host] Readline error:', err.message);
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
                                console.error('[IPC Host] Authentication failed — closing socket.');
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
                        console.error('[IPC Host] Failed to process line:', err);
                    }
                });
            });

            this.server.on('error', reject);
            this.server.listen(0, '127.0.0.1', () => {
                const port = (this.server!.address() as net.AddressInfo).port;
                console.error(`[IPC Host] Server listening on port ${port}`);
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
                console.error('[IPC Terminal] Connection error:', err);
                reject(err);
            });

            this.client.on('close', () => {
                console.error('[IPC Terminal] Connection closed.');
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
                console.error('[IPC Terminal] Readline error:', err.message);
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
                        console.error(`[IPC Terminal] Connected to Host on port ${port}`);
                        resolve();
                        return;
                    }

                    const res: IpcResponse = JSON.parse(line);
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
                    console.error('[IPC Terminal] Failed to process line:', err);
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

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`IPC request '${name}' timed out after 30s`));
            }, 30_000);

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

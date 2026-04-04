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

                // SEC-H-3: Track cumulative received bytes and enforce 1 MB limit.
                let totalBytes = 0;
                socket.on('data', (chunk) => {
                    totalBytes += chunk.length;
                    if (totalBytes > MAX_MSG_BYTES) {
                        socket.destroy(new Error('IPC message size limit exceeded'));
                    }
                });

                // SEC-C-1: Send challenge immediately on connection.
                socket.write(JSON.stringify({ challenge: nonce }) + '\n');

                let authenticated = false;

                const rl = readline.createInterface({ input: socket });
                rl.on('error', (err) => {
                    console.error('[IPC Host] Readline error:', err.message);
                });
                rl.on('line', async (line) => {
                    try {
                        // SEC-C-1: If not yet authenticated, expect auth response first.
                        if (!authenticated) {
                            const msg: { auth?: string } = JSON.parse(line);
                            if (msg.auth !== nonce) {
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
                            } catch (err: any) {
                                socket.write(JSON.stringify({ id: req.id, error: err.message }) + '\n');
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
                this.emit('disconnected');
            });

            let authResolved = false;
            const rl = readline.createInterface({ input: this.client });
            rl.on('error', (err) => {
                console.error('[IPC Terminal] Readline error:', err.message);
            });
            rl.on('line', (line) => {
                try {
                    // SEC-C-1: First message from Host is the challenge; respond with nonce.
                    if (!authResolved) {
                        const msg: { challenge?: string } = JSON.parse(line);
                        if (msg.challenge === undefined) {
                            const err = new Error('[IPC Terminal] Expected challenge from Host but got unexpected message.');
                            reject(err);
                            this.client?.destroy();
                            return;
                        }
                        // Send auth response with the nonce from lock file.
                        this.client!.write(JSON.stringify({ auth: nonce }) + '\n');
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

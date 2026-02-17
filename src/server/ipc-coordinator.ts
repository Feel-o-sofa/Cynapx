/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as net from 'net';
import * as readline from 'readline';
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
     */
    public async startHost(): Promise<number> {
        this.close();
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                socket.on('error', (err) => {
                    // Ignore common disconnect errors
                    console.error('[IPC Host] Socket error:', err.message);
                });

                const rl = readline.createInterface({ input: socket });
                rl.on('error', (err) => {
                    console.error('[IPC Host] Readline error:', err.message);
                });
                rl.on('line', async (line) => {
                    try {
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
     */
    public async connectToHost(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client = net.createConnection({ port, host: '127.0.0.1' }, () => {
                console.error(`[IPC Terminal] Connected to Host on port ${port}`);
                resolve();
            });

            this.client.on('error', (err) => {
                console.error('[IPC Terminal] Connection error:', err);
                reject(err);
            });

            this.client.on('close', () => {
                console.error('[IPC Terminal] Connection closed.');
                this.emit('disconnected');
            });

            const rl = readline.createInterface({ input: this.client });
            rl.on('error', (err) => {
                console.error('[IPC Terminal] Readline error:', err.message);
            });
            rl.on('line', (line) => {
                try {
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

        const id = Math.random().toString(36).substring(7);
        const req: IpcRequest = {
            id,
            method: 'executeTool',
            params: { name, args }
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.client!.write(JSON.stringify(req) + '\n');
        });
    }

    public close() {
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

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 13-2 regression tests for the IPC coordinator:
 *
 * - C-3 (diagnostic-v10): the Host must NOT send the auth secret (nonce) as
 *   the challenge. A client that does not know the nonce but simply echoes
 *   the received challenge back as `auth` must FAIL authentication.
 *   (Against the pre-fix protocol — `socket.write({challenge: nonce})` +
 *   `msg.auth !== nonce` — both the "challenge is not the nonce" and the
 *   "echo client is rejected" tests below fail.)
 * - H-8 (diagnostic-v10): the 1 MB IPC size limit is per message (line), not
 *   cumulative over the socket lifetime — long-lived sessions with > 1 MB of
 *   total traffic must stay connected, while a single oversized message is
 *   still rejected.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as net from 'net';
import * as readline from 'readline';
import { IpcCoordinator, computeAuthResponse } from '../src/server/ipc-coordinator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RawClient {
    socket: net.Socket;
    /** Resolves with the next complete line received from the host. */
    nextLine(): Promise<string>;
    /** Resolves when the host closes the connection. */
    closed: Promise<void>;
    isClosed(): boolean;
}

function connectRaw(port: number): Promise<RawClient> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ port, host: '127.0.0.1' });
        socket.on('error', () => { /* swallowed — `closed` covers teardown */ });

        const lines: string[] = [];
        const waiters: Array<(line: string) => void> = [];
        const rl = readline.createInterface({ input: socket });
        rl.on('line', (line) => {
            const waiter = waiters.shift();
            if (waiter) waiter(line);
            else lines.push(line);
        });

        let closedFlag = false;
        const closed = new Promise<void>((res) => {
            socket.on('close', () => { closedFlag = true; res(); });
        });

        socket.on('connect', () => resolve({
            socket,
            nextLine: () => {
                const buffered = lines.shift();
                if (buffered !== undefined) return Promise.resolve(buffered);
                return new Promise<string>((res, rej) => {
                    const timer = setTimeout(() => rej(new Error('Timed out waiting for line')), 5000);
                    waiters.push((l) => { clearTimeout(timer); res(l); });
                });
            },
            closed,
            isClosed: () => closedFlag,
        }));
        socket.once('error', reject);
    });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_res, rej) => setTimeout(() => rej(new Error(`Timed out: ${label}`)), ms)),
    ]);
}

const NONCE = 'super-secret-lock-file-nonce';

// ---------------------------------------------------------------------------
// C-3: challenge-response must not leak the nonce / echo must fail
// ---------------------------------------------------------------------------

describe('C-3: IPC challenge-response authentication', () => {
    let host: IpcCoordinator;
    let raw: RawClient | null = null;

    afterEach(() => {
        raw?.socket.destroy();
        raw = null;
        host?.close();
    });

    it('the challenge sent by the Host is NOT the nonce (secret never on the wire)', async () => {
        host = new IpcCoordinator();
        const port = await host.startHost(NONCE);
        raw = await connectRaw(port);

        const first = JSON.parse(await raw.nextLine());
        expect(typeof first.challenge).toBe('string');
        // Core C-3 regression: the pre-fix code sent the nonce itself.
        expect(first.challenge).not.toBe(NONCE);
        expect(first.challenge).not.toContain(NONCE);
    });

    it('each connection gets a fresh one-time challenge', async () => {
        host = new IpcCoordinator();
        const port = await host.startHost(NONCE);

        const c1 = await connectRaw(port);
        const c2 = await connectRaw(port);
        const ch1 = JSON.parse(await c1.nextLine()).challenge;
        const ch2 = JSON.parse(await c2.nextLine()).challenge;
        expect(ch1).not.toBe(ch2);
        c1.socket.destroy();
        c2.socket.destroy();
    });

    it('a client that does NOT know the nonce but echoes the challenge back FAILS auth', async () => {
        const executeTool = vi.fn().mockResolvedValue({ ok: true });
        host = new IpcCoordinator({ executeTool } as any);
        const port = await host.startHost(NONCE);
        raw = await connectRaw(port);

        const { challenge } = JSON.parse(await raw.nextLine());

        // Attack from the pre-fix protocol: reflect the challenge as auth,
        // then immediately try to execute a tool.
        raw.socket.write(JSON.stringify({ auth: challenge }) + '\n');
        raw.socket.write(JSON.stringify({
            id: 'attack-1', method: 'executeTool', params: { name: 'purge_index', args: {} },
        }) + '\n');

        await withTimeout(raw.closed, 5000, 'host should destroy the unauthenticated socket');
        expect(executeTool).not.toHaveBeenCalled();
    });

    it('a client using the WRONG nonce for the HMAC response fails auth', async () => {
        const executeTool = vi.fn().mockResolvedValue({ ok: true });
        host = new IpcCoordinator({ executeTool } as any);
        const port = await host.startHost(NONCE);
        raw = await connectRaw(port);

        const { challenge } = JSON.parse(await raw.nextLine());
        raw.socket.write(JSON.stringify({ auth: computeAuthResponse('wrong-nonce', challenge) }) + '\n');
        raw.socket.write(JSON.stringify({
            id: 'attack-2', method: 'executeTool', params: { name: 'search_symbols', args: {} },
        }) + '\n');

        await withTimeout(raw.closed, 5000, 'host should destroy the socket on bad HMAC');
        expect(executeTool).not.toHaveBeenCalled();
    });

    it('a client that responds with HMAC-SHA256(nonce, challenge) authenticates and can execute tools', async () => {
        const executeTool = vi.fn().mockResolvedValue({ content: [{ text: 'ok' }] });
        host = new IpcCoordinator({ executeTool } as any);
        const port = await host.startHost(NONCE);
        raw = await connectRaw(port);

        const { challenge } = JSON.parse(await raw.nextLine());
        raw.socket.write(JSON.stringify({ auth: computeAuthResponse(NONCE, challenge) }) + '\n');
        raw.socket.write(JSON.stringify({
            id: 'legit-1', method: 'executeTool', params: { name: 'some_tool', args: { q: 1 } },
        }) + '\n');

        const res = JSON.parse(await raw.nextLine());
        expect(res.id).toBe('legit-1');
        expect(res.result).toEqual({ content: [{ text: 'ok' }] });
        expect(executeTool).toHaveBeenCalledWith('some_tool', { q: 1 });
    });

    it('IpcCoordinator Terminal with the correct nonce round-trips end-to-end (no nonce on the wire)', async () => {
        const executeTool = vi.fn().mockResolvedValue('result-42');
        host = new IpcCoordinator({ executeTool } as any);
        const port = await host.startHost(NONCE);

        const client = new IpcCoordinator();
        // Capture everything the Terminal writes to the socket to prove the
        // nonce never travels in either direction.
        await client.connectToHost(port, NONCE);
        const written: string[] = [];
        const sock: net.Socket = (client as any).client;
        const origWrite = sock.write.bind(sock);
        (sock as any).write = (data: any, ...rest: any[]) => {
            written.push(String(data));
            return origWrite(data, ...rest);
        };

        await expect(client.forwardExecuteTool('a_tool', { x: 1 })).resolves.toBe('result-42');
        for (const w of written) expect(w).not.toContain(NONCE);
        client.close();
    });
});

// ---------------------------------------------------------------------------
// H-8: per-message (not cumulative) size limit
// ---------------------------------------------------------------------------

describe('H-8: IPC message size limit is per message, not cumulative', () => {
    let host: IpcCoordinator;
    let raw: RawClient | null = null;

    afterEach(() => {
        raw?.socket.destroy();
        raw = null;
        host?.close();
    });

    async function connectAuthenticated(port: number): Promise<RawClient> {
        const c = await connectRaw(port);
        const { challenge } = JSON.parse(await c.nextLine());
        c.socket.write(JSON.stringify({ auth: computeAuthResponse(NONCE, challenge) }) + '\n');
        return c;
    }

    it('a long-lived connection survives > 1 MB of cumulative normal-size traffic', async () => {
        const executeTool = vi.fn().mockResolvedValue('still-alive');
        host = new IpcCoordinator({ executeTool } as any);
        const port = await host.startHost(NONCE);
        raw = await connectAuthenticated(port);

        // ~2200 messages x ~512 bytes ≈ 1.1 MB cumulative — every message is
        // far below the 1 MB single-message limit. The pre-fix cumulative
        // counter destroyed the socket partway through this loop.
        const padding = 'p'.repeat(460);
        const message = JSON.stringify({ id: 'noop', method: 'noop', pad: padding }) + '\n';
        const totalMessages = Math.ceil((1.2 * 1024 * 1024) / message.length);
        for (let i = 0; i < totalMessages; i += 1) {
            raw.socket.write(message);
        }
        // Give the host time to consume the burst.
        await new Promise((r) => setTimeout(r, 300));
        expect(raw.isClosed()).toBe(false);

        // The connection must still be fully functional.
        raw.socket.write(JSON.stringify({
            id: 'after-burst', method: 'executeTool', params: { name: 't', args: {} },
        }) + '\n');
        const res = JSON.parse(await raw.nextLine());
        expect(res.id).toBe('after-burst');
        expect(res.result).toBe('still-alive');
    }, 20_000);

    it('a single message exceeding 1 MB destroys the connection', async () => {
        host = new IpcCoordinator();
        const port = await host.startHost(NONCE);
        raw = await connectAuthenticated(port);

        // One unterminated line > 1 MB.
        raw.socket.write('x'.repeat(1024 * 1024 + 16));
        await withTimeout(raw.closed, 5000, 'host should destroy the socket on oversized message');
    });

    it('an oversized line is rejected even when it ends with a newline in the same chunk', async () => {
        host = new IpcCoordinator();
        const port = await host.startHost(NONCE);
        raw = await connectAuthenticated(port);

        raw.socket.write('y'.repeat(1024 * 1024 + 16) + '\n');
        await withTimeout(raw.closed, 5000, 'host should destroy the socket on oversized terminated message');
    });
});

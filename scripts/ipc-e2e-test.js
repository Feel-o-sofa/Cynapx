/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * Phase 13-9 — IPC 2-process end-to-end test (diagnostic-v10 §5 "IPC 2-프로세스
 * e2e" gap). Unlike tests/ipc-coordinator.test.ts (single-process, in-VM), this
 * spawns ACTUAL separate OS processes that talk over a real 127.0.0.1 TCP socket
 * using the compiled dist/ IpcCoordinator — the realistic Host/Terminal split.
 *
 * Three scenarios:
 *   (a) C-3: a malicious echo client (separate process) that does NOT know the
 *       HMAC nonce and merely reflects the challenge is rejected — the Host
 *       destroys the socket and never executes a tool.
 *   (b) H-8: sustained > 1 MB of traffic spread over many small messages keeps a
 *       real Terminal connection alive (the per-line limit, not a cumulative
 *       one) and the connection stays fully functional afterwards.
 *   (c) H-1: killing the Host PROCESS (SIGKILL) makes the Terminal observe a
 *       'disconnected' event — the trigger bootstrap uses for failover/promotion.
 *
 * This file is BOTH the orchestrator (no args / `run`) and the child entrypoints
 * (`host`, `echo-attacker`), selected by argv[2]. It is invoked as a phase from
 * scripts/integration-test.js and exits non-zero on any failed scenario.
 *
 * Requires `npm run build` first (consumes dist/).
 */
'use strict';

const path = require('path');
const net = require('net');
const crypto = require('crypto');
const readline = require('readline');
const { fork, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { IpcCoordinator, computeAuthResponse } = require(path.join(ROOT, 'dist/server/ipc-coordinator'));

const NONCE = 'e2e-secret-nonce-' + crypto.randomBytes(6).toString('hex');

// ───────────────────────────────────────────────────────────────────────────
// Child entrypoint: HOST
//
// Starts a real IpcCoordinator Host bound to an ephemeral 127.0.0.1 port, with
// a fake mcpServer whose executeTool records that it was reached. Prints the
// chosen port as `PORT=<n>` on stdout so the parent can connect, then runs until
// killed. If a tool is ever executed it prints `TOOL_EXECUTED=<name>`.
// ───────────────────────────────────────────────────────────────────────────
async function runHostChild() {
    const fakeMcp = {
        executeTool: async (name) => {
            // Should only ever happen for an AUTHENTICATED client.
            process.stdout.write(`TOOL_EXECUTED=${name}\n`);
            return { content: [{ text: 'ok' }] };
        },
    };
    const host = new IpcCoordinator(fakeMcp);
    const port = await host.startHost(NONCE_FROM_ENV());
    process.stdout.write(`PORT=${port}\n`);
    // Keep alive until the parent kills us.
    setInterval(() => {}, 1 << 30);
}

// ───────────────────────────────────────────────────────────────────────────
// Child entrypoint: ECHO-ATTACKER (separate process, C-3)
//
// Connects to the Host, reads the first line (the challenge), and reflects it
// straight back as `auth` — the exact pre-fix attack. Then tries to invoke a
// privileged tool. Prints the outcome and exits.
// ───────────────────────────────────────────────────────────────────────────
function runEchoAttackerChild(port) {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    let destroyed = false;
    const finish = () => {
        if (destroyed) return;
        destroyed = true;
        process.stdout.write('SOCKET_CLOSED\n');
        // Flush stdout before exiting.
        process.stdout.write('', () => process.exit(0));
    };
    sock.on('close', finish);
    // The Host destroys the socket on bad auth → ECONNRESET. Swallow it (both on
    // the socket and the readline) so it does not crash the process before the
    // 'close' handler reports SOCKET_CLOSED.
    sock.on('error', () => {});
    const rl = readline.createInterface({ input: sock });
    rl.on('error', () => {});
    let sawChallenge = false;
    rl.on('line', (line) => {
        try {
            const msg = JSON.parse(line);
            if (!sawChallenge && typeof msg.challenge === 'string') {
                sawChallenge = true;
                // ATTACK: echo the challenge back as auth (we do NOT know the nonce).
                sock.write(JSON.stringify({ auth: msg.challenge }) + '\n');
                sock.write(JSON.stringify({
                    id: 'attack', method: 'executeTool',
                    params: { name: 'purge_index', args: {} },
                }) + '\n');
                return;
            }
            // If we EVER get a response with a result, auth was (wrongly) accepted.
            if (msg.id === 'attack') {
                process.stdout.write('ATTACK_GOT_RESPONSE\n');
            }
        } catch { /* ignore */ }
    });
    // Safety timeout: if the host never closes us, report and exit.
    setTimeout(() => {
        if (!destroyed) { process.stdout.write('SOCKET_STILL_OPEN\n'); process.exit(0); }
    }, 4000);
}

function NONCE_FROM_ENV() {
    return process.env.CYNAPX_E2E_NONCE || NONCE;
}

// ───────────────────────────────────────────────────────────────────────────
// Orchestrator helpers
// ───────────────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', X = '\x1b[0m', B = '\x1b[1m';
const results = [];
function record(label, passed, detail) {
    results.push({ label, passed });
    const tag = passed ? `${G}✅ PASS${X}` : `${R}❌ FAIL${X}`;
    console.log(`${tag}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Spawns a host child and resolves with { child, port } once it prints PORT=. */
function spawnHost() {
    return new Promise((resolve, reject) => {
        const child = fork(__filename, ['host'], {
            env: { ...process.env, CYNAPX_E2E_NONCE: NONCE },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        let buf = '';
        let resolved = false;
        const toolFlag = { executed: false };
        child.stdout.on('data', (d) => {
            buf += d.toString();
            if (buf.includes('TOOL_EXECUTED=')) toolFlag.executed = true;
            const m = buf.match(/PORT=(\d+)/);
            if (m && !resolved) {
                resolved = true;
                resolve({ child, port: Number(m[1]), toolFlag });
            }
        });
        child.stderr.on('data', () => {});
        child.on('error', reject);
        setTimeout(() => { if (!resolved) reject(new Error('host child did not report a port in time')); }, 8000);
    });
}

function waitForExit(child) {
    return new Promise((res) => child.once('exit', () => res()));
}

// ───────────────────────────────────────────────────────────────────────────
// Scenario (a): malicious echo client (separate process) is rejected
// ───────────────────────────────────────────────────────────────────────────
async function scenarioEchoAttacker() {
    const { child: host, port, toolFlag } = await spawnHost();
    try {
        const attacker = spawn(process.execPath, [__filename, 'echo-attacker', String(port)], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        attacker.stdout.on('data', (d) => { out += d.toString(); });
        await waitForExit(attacker);

        const socketClosed = out.includes('SOCKET_CLOSED');
        const gotResponse = out.includes('ATTACK_GOT_RESPONSE');
        // Give the host a beat to (not) execute the tool.
        await new Promise((r) => setTimeout(r, 200));

        record('IPC_E2E_ECHO_REJECTED (C-3)',
            socketClosed && !gotResponse && !toolFlag.executed,
            `socketClosed=${socketClosed} gotResponse=${gotResponse} toolExecuted=${toolFlag.executed}`);
    } finally {
        host.kill('SIGKILL');
        await waitForExit(host);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Scenario (b): sustained > 1 MB traffic over many small messages stays up
// ───────────────────────────────────────────────────────────────────────────
async function scenarioSustainedTraffic() {
    const { child: host, port } = await spawnHost();
    // The Terminal lives IN-PROCESS here (a real TCP connection to a real,
    // separate Host process) so we can drive forwardExecuteTool and observe the
    // result — the cross-process boundary that matters (the 1 MB limit) is on
    // the Host side.
    const terminal = new IpcCoordinator();
    let disconnected = false;
    terminal.on('disconnected', () => { disconnected = true; });
    try {
        await terminal.connectToHost(port, NONCE);

        // Push ~1.2 MB across many small lines straight down the socket. Each
        // message is far under the 1 MB single-message cap; the pre-fix
        // cumulative counter would have severed the connection mid-stream.
        const sock = terminal.client; // private; fine for an e2e harness
        const padding = 'p'.repeat(460);
        const message = JSON.stringify({ id: 'noop', method: 'noop', pad: padding }) + '\n';
        const count = Math.ceil((1.2 * 1024 * 1024) / message.length);
        for (let i = 0; i < count; i++) sock.write(message);

        await new Promise((r) => setTimeout(r, 400));
        const stillUp = !disconnected;

        // The connection must remain fully functional after the burst.
        let roundTripOk = false;
        try {
            const res = await terminal.forwardExecuteTool('search_symbols', { query: 'x' });
            roundTripOk = !!(res && res.content);
        } catch { roundTripOk = false; }

        record('IPC_E2E_SUSTAINED_1MB (H-8)',
            stillUp && roundTripOk,
            `~${(count * message.length / 1024 / 1024).toFixed(2)}MB sent, stillUp=${stillUp} roundTrip=${roundTripOk}`);
    } finally {
        terminal.close();
        host.kill('SIGKILL');
        await waitForExit(host);
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Scenario (c): killing the Host process triggers Terminal disconnect (failover)
// ───────────────────────────────────────────────────────────────────────────
async function scenarioHostKillFailover() {
    const { child: host, port } = await spawnHost();
    const terminal = new IpcCoordinator();
    const disconnected = new Promise((resolve) => terminal.once('disconnected', () => resolve(true)));
    try {
        await terminal.connectToHost(port, NONCE);

        // Hard-kill the Host process — the realistic crash that failover defends
        // against. The Terminal must observe a 'disconnected' event (the signal
        // bootstrap's attemptFailover keys on) within a bounded time.
        host.kill('SIGKILL');

        const sawDisconnect = await Promise.race([
            disconnected,
            new Promise((res) => setTimeout(() => res(false), 5000)),
        ]);
        record('IPC_E2E_HOST_KILL_FAILOVER (H-1)', sawDisconnect === true,
            `disconnected event observed=${sawDisconnect}`);
    } finally {
        terminal.close();
        if (!host.killed) host.kill('SIGKILL');
        await waitForExit(host).catch(() => {});
    }
}

async function runOrchestrator() {
    console.log(`\n${B}── IPC 2-process e2e (C-3 / H-8 / H-1) ──${X}`);
    try {
        await scenarioEchoAttacker();
        await scenarioSustainedTraffic();
        await scenarioHostKillFailover();
    } catch (e) {
        record('IPC_E2E_HARNESS', false, e && e.message);
    }
    const failed = results.filter((r) => !r.passed);
    if (failed.length) {
        console.log(`${R}${B}IPC e2e: ${failed.length}/${results.length} scenario(s) failed${X}`);
        process.exit(1);
    }
    console.log(`${G}IPC e2e: ${results.length}/${results.length} scenarios passed${X}`);
    process.exit(0);
}

// ───────────────────────────────────────────────────────────────────────────
// Dispatch
// ───────────────────────────────────────────────────────────────────────────
const mode = process.argv[2];
if (mode === 'host') {
    runHostChild().catch((e) => { console.error(e); process.exit(1); });
} else if (mode === 'echo-attacker') {
    runEchoAttackerChild(Number(process.argv[3]));
} else {
    runOrchestrator();
}

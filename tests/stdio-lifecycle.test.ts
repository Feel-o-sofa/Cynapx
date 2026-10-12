/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * End-to-end gate for the stdio MCP process lifecycle, run through the same
 * source runner `.mcp.json` and `npm start` use (tsx).
 *
 * It guards two defects that unit tests could not see:
 *   1. The source-run path was broken: src/ imports use `.js` suffixes that
 *      ts-node (CJS) could not map to `.ts`, so `npm start`, `npm run dev` and
 *      the `.mcp.json` server all crashed at startup while vitest (vite
 *      resolution) and dist (tsc output) kept passing.
 *   2. The server ignored stdin EOF. MCP clients disconnect by closing stdin;
 *      a server that lingers gets SIGTERM'd, and when that signal only reaches
 *      the npx/tsx wrapper the real server is orphaned holding the singleton
 *      lock and IPC host.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

let projectDir: string;

beforeAll(() => {
    // No .cynapx-config anchor: the server starts in PENDING mode, which keeps
    // the test fast and leaves no index behind.
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-stdio-'));
});

afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
});

function startServer() {
    return spawn(TSX, ['src/bootstrap.ts', '--path', projectDir, '--no-index', '--no-watch'], {
        cwd: REPO_ROOT,
        env: { ...process.env, CYNAPX_EMBED_PROVIDER: 'null', CYNAPX_LOG_LEVEL: 'silent' },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}

describe('stdio MCP lifecycle (source runner)', () => {
    it('answers initialize from source and exits cleanly when the client closes stdin', async () => {
        const child = startServer();
        let stdout = '';
        child.stdout.on('data', d => { stdout += d.toString(); });

        const initialized = new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`no initialize response; stdout so far: ${stdout.slice(0, 200)}`)), 45_000);
            child.stdout.on('data', () => {
                const line = stdout.split('\n').find(l => l.includes('"id":1'));
                if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
            });
        });
        const exited = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)));

        child.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'lifecycle-test', version: '1.0' } },
        }) + '\n');

        const response = await initialized;
        expect(response.result.serverInfo.name).toBe('cynapx');

        // Every stdout line must be JSON-RPC: stdout is the protocol channel.
        for (const line of stdout.split('\n').filter(l => l.trim())) {
            expect(() => JSON.parse(line)).not.toThrow();
        }

        // Client disconnect per the MCP stdio lifecycle: close stdin, wait.
        child.stdin.end();
        const code = await Promise.race([
            exited,
            new Promise<'lingered'>(resolve => setTimeout(() => resolve('lingered'), 20_000)),
        ]);
        if (code === 'lingered') child.kill('SIGKILL');
        expect(code).toBe(0);
    }, 90_000);
});

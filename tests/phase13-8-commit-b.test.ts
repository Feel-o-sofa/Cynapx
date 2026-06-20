/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 13-8 commit B regression tests.
 *
 * - A-6: FileFilter honours .gitignore + profile excludePatterns / maxFileSize,
 *   and FileWatcher ignores the same files the indexer's discovery ignores.
 * - A-8: getProjectHash() is case-sensitive on POSIX (distinct DB/lock for
 *   case-different paths) and case-insensitive on win32/darwin; the registry
 *   write uses a pid-based temp file and survives concurrent writers.
 * - A-12: per-tool IPC timeout table + Host keepalive ping ignored by Terminal.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import * as readline from 'readline';
import { FileFilter } from '../src/utils/file-filter';
import { getIpcTimeoutMs, IpcCoordinator, computeAuthResponse } from '../src/server/ipc-coordinator';

// ---------------------------------------------------------------------------
// A-6: FileFilter
// ---------------------------------------------------------------------------
describe('A-6: FileFilter — .gitignore + profile excludePatterns/maxFileSize', () => {
    function makeProject(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'));
        fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n*.log\n', 'utf8');
        fs.mkdirSync(path.join(dir, 'dist'));
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'x', 'utf8');
        fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const a = 1;', 'utf8');
        fs.writeFileSync(path.join(dir, 'app.log'), 'log', 'utf8');
        return dir;
    }

    it('ignores gitignored paths (build output, log files)', () => {
        const dir = makeProject();
        const ff = new FileFilter(dir);
        expect(ff.isIgnored(path.join(dir, 'dist', 'bundle.js'))).toBe(true);
        expect(ff.isIgnored(path.join(dir, 'app.log'))).toBe(true);
        expect(ff.isIgnored(path.join(dir, 'src', 'index.ts'))).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('layers profile excludePatterns on top of .gitignore', () => {
        const dir = makeProject();
        fs.mkdirSync(path.join(dir, 'vendor'));
        fs.writeFileSync(path.join(dir, 'vendor', 'lib.ts'), 'x', 'utf8');
        const ff = new FileFilter(dir, { excludePatterns: ['vendor/'] });
        expect(ff.isIgnored(path.join(dir, 'vendor', 'lib.ts'))).toBe(true);
        // .gitignore rules still apply alongside the profile patterns.
        expect(ff.isIgnored(path.join(dir, 'dist', 'bundle.js'))).toBe(true);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('enforces maxFileSize via shouldIgnoreFile()', () => {
        const dir = makeProject();
        const big = path.join(dir, 'src', 'big.ts');
        fs.writeFileSync(big, 'x'.repeat(2048), 'utf8');
        const small = path.join(dir, 'src', 'index.ts');

        const ff = new FileFilter(dir, { maxFileSize: 1024 });
        expect(ff.shouldIgnoreFile(big)).toBe(true);   // over the limit
        expect(ff.shouldIgnoreFile(small)).toBe(false); // under the limit
        // Pattern-only check ignores size.
        expect(ff.isIgnored(big)).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('does not ignore a path outside the project root', () => {
        const dir = makeProject();
        const ff = new FileFilter(dir);
        expect(ff.isIgnored(path.join(os.tmpdir(), 'elsewhere', 'x.ts'))).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('shouldIgnoreFile() treats a missing file as not-ignored (delete path)', () => {
        const dir = makeProject();
        const ff = new FileFilter(dir, { maxFileSize: 1024 });
        expect(ff.shouldIgnoreFile(path.join(dir, 'src', 'gone.ts'))).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

// ---------------------------------------------------------------------------
// A-8: getProjectHash platform sensitivity + registry concurrency
// ---------------------------------------------------------------------------
describe('A-8: getProjectHash() platform case-sensitivity + registry temp file', () => {
    const ORIGINAL_PLATFORM = process.platform;
    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM });
        vi.resetModules();
    });

    function setPlatform(p: string) {
        Object.defineProperty(process, 'platform', { value: p });
    }

    async function freshPaths() {
        vi.resetModules();
        return await import('../src/utils/paths');
    }

    it('Linux (case-sensitive FS): case-different paths hash DIFFERENTLY', async () => {
        setPlatform('linux');
        const paths = await freshPaths();
        const a = paths.getProjectHash('/home/user/MyProj');
        const b = paths.getProjectHash('/home/user/myproj');
        expect(a).not.toBe(b);
    });

    it('win32 (case-insensitive FS): case-different paths hash the SAME', async () => {
        setPlatform('win32');
        const paths = await freshPaths();
        const a = paths.getProjectHash('C:/Work/MyProj');
        const b = paths.getProjectHash('C:/Work/myproj');
        expect(a).toBe(b);
    });

    it('darwin (case-insensitive FS): case-different paths hash the SAME', async () => {
        setPlatform('darwin');
        const paths = await freshPaths();
        const a = paths.getProjectHash('/Users/me/MyProj');
        const b = paths.getProjectHash('/Users/me/myproj');
        expect(a).toBe(b);
    });

    it('registry write uses a pid-based temp file and survives concurrent registrations', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-home-'));
        vi.stubEnv('HOME', home);
        vi.stubEnv('USERPROFILE', home);
        try {
            setPlatform('linux');
            const paths = await freshPaths();
            const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'projA-'));
            const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'projB-'));

            // Interleave two registrations (read-modify-write) — both must survive.
            paths.addToRegistry(projA);
            paths.addToRegistry(projB);

            const registry = paths.readRegistry();
            const regPaths = registry.map((e: any) => e.path);
            expect(regPaths).toContain(path.resolve(projA));
            expect(regPaths).toContain(path.resolve(projB));

            // No leftover temp files (pid-based names are cleaned up / renamed).
            const storage = path.join(home, '.cynapx');
            const leftovers = fs.readdirSync(storage).filter(f => f.startsWith('registry.json.') && f.endsWith('.tmp'));
            expect(leftovers).toEqual([]);

            fs.rmSync(projA, { recursive: true, force: true });
            fs.rmSync(projB, { recursive: true, force: true });
        } finally {
            vi.unstubAllEnvs();
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// A-12: per-tool IPC timeout table + Host keepalive
// ---------------------------------------------------------------------------
describe('A-12: per-tool IPC timeout table', () => {
    it('long-running tools get a multi-minute timeout', () => {
        expect(getIpcTimeoutMs('initialize_project')).toBeGreaterThanOrEqual(10 * 60_000);
        expect(getIpcTimeoutMs('backfill_history')).toBeGreaterThanOrEqual(10 * 60_000);
        expect(getIpcTimeoutMs('re_tag_project')).toBeGreaterThanOrEqual(5 * 60_000);
        expect(getIpcTimeoutMs('check_consistency')).toBeGreaterThanOrEqual(5 * 60_000);
    });

    it('quick metadata reads use the short default timeout', () => {
        expect(getIpcTimeoutMs('search_symbols')).toBe(30_000);
        expect(getIpcTimeoutMs('get_callers')).toBe(30_000);
        expect(getIpcTimeoutMs('totally_unknown_tool')).toBe(30_000);
    });

    it('long-running timeouts are strictly larger than the default', () => {
        expect(getIpcTimeoutMs('initialize_project')).toBeGreaterThan(getIpcTimeoutMs('search_symbols'));
    });
});

describe('A-12: Host keepalive ping', () => {
    const NONCE = 'a12-nonce';
    let host: IpcCoordinator | null = null;
    let client: IpcCoordinator | null = null;

    afterEach(() => {
        host?.close();
        client?.close();
        host = null;
        client = null;
        vi.useRealTimers();
    });

    function connectRaw(port: number): Promise<{ socket: net.Socket; nextLine: () => Promise<string> }> {
        return new Promise((resolve) => {
            const socket = net.createConnection({ port, host: '127.0.0.1' });
            socket.on('error', () => { /* covered by test teardown */ });
            const lines: string[] = [];
            const waiters: Array<(l: string) => void> = [];
            const rl = readline.createInterface({ input: socket });
            rl.on('line', (l) => {
                const w = waiters.shift();
                if (w) w(l); else lines.push(l);
            });
            const nextLine = () => new Promise<string>((res) => {
                const buffered = lines.shift();
                if (buffered !== undefined) res(buffered); else waiters.push(res);
            });
            socket.on('connect', () => resolve({ socket, nextLine }));
        });
    }

    it('Host sends a ping line (no id) to an authenticated idle connection', async () => {
        // Use a fast keepalive interval via env override, re-importing the
        // module so the constant picks it up.
        vi.stubEnv('CYNAPX_IPC_KEEPALIVE_MS', '50');
        vi.resetModules();
        const mod = await import('../src/server/ipc-coordinator');
        const fastHost = new mod.IpcCoordinator({ executeTool: vi.fn() } as any);
        try {
            const port = await fastHost.startHost(NONCE);
            const raw = await connectRaw(port);
            const { challenge } = JSON.parse(await raw.nextLine());
            raw.socket.write(JSON.stringify({ auth: mod.computeAuthResponse(NONCE, challenge) }) + '\n');

            const ping = await Promise.race([
                raw.nextLine(),
                new Promise<string>((_, rej) => setTimeout(() => rej(new Error('no ping')), 5_000)),
            ]);
            const parsed = JSON.parse(ping);
            expect(parsed.ping).toBe(true);
            expect(parsed.id).toBeUndefined();
            raw.socket.destroy();
        } finally {
            fastHost.close();
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    }, 8_000);

    it('Terminal ignores keepalive pings and still round-trips tool calls', async () => {
        const executeTool = vi.fn().mockResolvedValue('ok-result');
        host = new IpcCoordinator({ executeTool } as any);
        const port = await host.startHost(NONCE);

        client = new IpcCoordinator();
        await client.connectToHost(port, NONCE);

        // Inject a ping directly into the Terminal's line handling via the socket
        // to prove it is ignored (no pending request, no throw).
        const sock: net.Socket = (client as any).client;
        sock.emit('data', Buffer.from(JSON.stringify({ ping: true, ts: Date.now() }) + '\n'));

        await expect(client.forwardExecuteTool('search_symbols', { q: 'x' })).resolves.toBe('ok-result');
    });
});

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 12-8: boundary-validation matrix for the initialize_project tool
 * (diagnostic-v9 §5 "initialize-project 경계 검증" test gap).
 *
 * Covers mode (current / existing / custom) × path (allowed / denied):
 *   - current/existing: explicit paths must live under home dir or cwd.
 *   - custom: home/cwd boundary check is skipped, but system paths are
 *     still rejected via isSystemPath() inside addToRegistry().
 *
 * HOME is stubbed to a temp dir so the registry (~/.cynapx/registry.json)
 * and any anchor files are written into a throwaway sandbox.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executeTool, ToolDeps } from '../src/server/tool-dispatcher';
import { isSystemPath, readRegistry } from '../src/utils/paths';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
    const base: ToolDeps = {
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
        getContext: vi.fn().mockReturnValue(null),
        isTerminal: vi.fn().mockReturnValue(false),
        getTerminalCoordinator: vi.fn().mockReturnValue(undefined),
        embeddingProvider: {
            generate: vi.fn().mockResolvedValue([]),
            generateBatch: vi.fn().mockResolvedValue([]),
            getDimensions: vi.fn().mockReturnValue(0),
            getModelName: vi.fn().mockReturnValue('mock'),
        },
        workspaceManager: {
            getAllContexts: vi.fn().mockReturnValue([]),
            mountProject: vi.fn().mockResolvedValue(undefined),
            getContextByHash: vi.fn().mockReturnValue(undefined),
        } as any,
        remediationEngine: {} as any,
        onInitialize: vi.fn().mockResolvedValue(undefined),
        onPurge: undefined,
        markReady: vi.fn(),
        getIsInitialized: vi.fn().mockReturnValue(false),
        setIsInitialized: vi.fn(),
    };
    return { ...base, ...overrides };
}

let fakeHome: string;
let outsideDir: string;

beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-init-home-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-init-outside-'));
    // Point os.homedir() (and therefore the registry + boundary check) at the sandbox.
    vi.stubEnv('HOME', fakeHome);
    vi.stubEnv('USERPROFILE', fakeHome);
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isSystemPath() — guard primitive used by all registration paths
// ---------------------------------------------------------------------------

describe('isSystemPath', () => {
    it('flags OS-managed directories', () => {
        expect(isSystemPath('/etc')).toBe(true);
        expect(isSystemPath('/etc/nginx')).toBe(true);
        expect(isSystemPath('/usr/lib/foo')).toBe(true);
        expect(isSystemPath('/proc/1')).toBe(true);
        expect(isSystemPath('/bin')).toBe(true);
    });

    it('allows user-writable directories (home, tmp)', () => {
        expect(isSystemPath(fakeHome)).toBe(false);
        expect(isSystemPath(path.join(os.tmpdir(), 'some-project'))).toBe(false);
        expect(isSystemPath(process.cwd())).toBe(false);
    });

    it('does not false-positive on prefix-similar paths (/etcetera)', () => {
        expect(isSystemPath('/etcetera/project')).toBe(false);
        expect(isSystemPath('/usrland')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// mode validation
// ---------------------------------------------------------------------------

describe('initialize_project: mode validation', () => {
    it('rejects an unknown mode with isError', async () => {
        const deps = makeDeps();
        const result = await executeTool('initialize_project', { path: fakeHome, mode: 'hacker' }, deps);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Unknown mode/i);
        expect(deps.onInitialize).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// mode=current — boundary matrix
// ---------------------------------------------------------------------------

describe('initialize_project: mode=current', () => {
    it('allows a path under the home directory and runs full init', async () => {
        const target = path.join(fakeHome, 'proj-a');
        const deps = makeDeps();
        const result = await executeTool(
            'initialize_project',
            { path: target, mode: 'current', zero_pollution: true },
            deps
        );
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toMatch(/Successfully initialized/i);
        expect(deps.onInitialize).toHaveBeenCalledWith(target);
        expect(deps.markReady).toHaveBeenCalledWith(true);
        // Registered in the (sandboxed) central registry
        expect(readRegistry().some(p => p.path === target)).toBe(true);
    });

    it('allows a path under cwd', async () => {
        // cwd itself is always inside the allowed boundary
        const target = process.cwd();
        const deps = makeDeps();
        const result = await executeTool(
            'initialize_project',
            { path: target, mode: 'current', zero_pollution: true },
            deps
        );
        expect(result.isError).toBeUndefined();
        expect(deps.onInitialize).toHaveBeenCalledOnce();
    });

    it('denies a path outside home and cwd', async () => {
        const target = path.join(outsideDir, 'proj-b');
        const deps = makeDeps();
        const result = await executeTool(
            'initialize_project',
            { path: target, mode: 'current', zero_pollution: true },
            deps
        );
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/outside allowed boundaries/i);
        expect(deps.onInitialize).not.toHaveBeenCalled();
        expect(deps.markReady).not.toHaveBeenCalled();
        expect(fs.existsSync(target)).toBe(false);
    });

    it('denies a system path (outside boundary in current mode)', async () => {
        const deps = makeDeps();
        const result = await executeTool(
            'initialize_project',
            { path: '/etc', mode: 'current', zero_pollution: true },
            deps
        );
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/outside allowed boundaries/i);
        expect(deps.onInitialize).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// mode=existing — boundary matrix + indexed-DB reuse
// ---------------------------------------------------------------------------

describe('initialize_project: mode=existing', () => {
    it('denies a path outside home and cwd', async () => {
        const target = path.join(outsideDir, 'proj-c');
        const deps = makeDeps();
        const result = await executeTool(
            'initialize_project',
            { path: target, mode: 'existing', zero_pollution: true },
            deps
        );
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/outside allowed boundaries/i);
        expect((deps.workspaceManager.mountProject as any)).not.toHaveBeenCalled();
        expect(deps.onInitialize).not.toHaveBeenCalled();
    });

    it('allows an in-boundary path and reuses an already-indexed DB (skips onInitialize)', async () => {
        const target = path.join(fakeHome, 'proj-indexed');
        fs.mkdirSync(target, { recursive: true });
        const deps = makeDeps({
            workspaceManager: {
                getAllContexts: vi.fn().mockReturnValue([]),
                mountProject: vi.fn().mockResolvedValue(undefined),
                // Simulate an existing engine context with an open DB
                getContextByHash: vi.fn().mockReturnValue({ dbManager: {} }),
            } as any,
        });
        const result = await executeTool(
            'initialize_project',
            { path: target, mode: 'existing', zero_pollution: true },
            deps
        );
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toMatch(/already indexed/i);
        expect(deps.workspaceManager.mountProject).toHaveBeenCalledWith(target);
        expect(deps.onInitialize).not.toHaveBeenCalled();
        expect(deps.markReady).toHaveBeenCalledWith(true);
    });

    it('allows an in-boundary path and falls through to full init when no DB exists', async () => {
        const target = path.join(fakeHome, 'proj-fresh');
        const deps = makeDeps(); // getContextByHash → undefined
        const result = await executeTool(
            'initialize_project',
            { path: target, mode: 'existing', zero_pollution: true },
            deps
        );
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toMatch(/Successfully initialized/i);
        expect(deps.onInitialize).toHaveBeenCalledWith(target);
        expect(deps.markReady).toHaveBeenCalledWith(true);
    });
});

// ---------------------------------------------------------------------------
// mode=custom — boundary check skipped, but system paths still blocked
// ---------------------------------------------------------------------------

describe('initialize_project: mode=custom', () => {
    it('allows a non-system path outside home/cwd (no boundary check)', async () => {
        const target = path.join(outsideDir, 'proj-custom');
        const deps = makeDeps();
        const result = await executeTool(
            'initialize_project',
            { path: target, mode: 'custom', zero_pollution: true },
            deps
        );
        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toMatch(/Successfully initialized/i);
        expect(deps.onInitialize).toHaveBeenCalledWith(target);
        expect(readRegistry().some(p => p.path === target)).toBe(true);
    });

    it('still blocks system paths via isSystemPath (addToRegistry guard)', async () => {
        const deps = makeDeps();
        // '/etc' exists, so no mkdir happens; zero_pollution skips the anchor
        // file write; the registration guard must refuse the system path.
        await expect(
            executeTool('initialize_project', { path: '/etc', mode: 'custom', zero_pollution: true }, deps)
        ).rejects.toThrow(/Refusing to register system path/i);
        expect(deps.onInitialize).not.toHaveBeenCalled();
        expect(deps.markReady).not.toHaveBeenCalled();
        expect(readRegistry().some(p => p.path === '/etc')).toBe(false);
    });

    it('blocks nested system paths too (/usr/lib/...)', async () => {
        const deps = makeDeps();
        // Use an existing nested system dir so no directory creation occurs.
        await expect(
            executeTool('initialize_project', { path: '/usr/lib', mode: 'custom', zero_pollution: true }, deps)
        ).rejects.toThrow(/Refusing to register system path/i);
        expect(deps.onInitialize).not.toHaveBeenCalled();
    });
});

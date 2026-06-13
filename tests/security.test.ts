import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { SecurityProvider } from '../src/utils/security';
import { isPathInside } from '../src/utils/paths';
import { CynapxError, CynapxErrorCode } from '../src/types';

describe('SecurityProvider', () => {
    let provider: SecurityProvider;
    const projectRoot = path.join(os.tmpdir(), 'cynapx-test-project');

    beforeEach(() => {
        provider = new SecurityProvider(projectRoot);
    });

    describe('validatePath', () => {
        it('should allow a path inside the project root', () => {
            const targetPath = path.join(projectRoot, 'src', 'index.ts');
            expect(() => provider.validatePath(targetPath)).not.toThrow();
        });

        it('should allow the project root itself', () => {
            expect(() => provider.validatePath(projectRoot)).not.toThrow();
        });

        it('should block a path traversal using ../ segments', () => {
            const traversalPath = path.join(projectRoot, '..', '..', '..', 'etc', 'passwd');
            expect(() => provider.validatePath(traversalPath)).toThrow(CynapxError);
        });

        it('should throw with PATH_TRAVERSAL_DENIED error code for blocked paths', () => {
            const traversalPath = path.join(projectRoot, '..', 'other-project', 'secrets.txt');
            try {
                provider.validatePath(traversalPath);
                expect.fail('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(CynapxError);
                expect((err as CynapxError).code).toBe(CynapxErrorCode.PATH_TRAVERSAL_DENIED);
            }
        });

        it('should block an absolute path outside the project root', () => {
            const outsidePath = os.tmpdir() === projectRoot
                ? path.join(os.homedir(), 'secrets.txt')
                : path.join(os.tmpdir(), 'other-file.txt');
            expect(() => provider.validatePath(outsidePath)).toThrow(CynapxError);
        });

        it('should block a completely different absolute path', () => {
            const differentPath = path.join(os.homedir(), '.ssh', 'id_rsa');
            expect(() => provider.validatePath(differentPath)).toThrow(CynapxError);
        });

        it('should allow a deeply nested path within the project', () => {
            const deepPath = path.join(projectRoot, 'a', 'b', 'c', 'd', 'file.ts');
            expect(() => provider.validatePath(deepPath)).not.toThrow();
        });

        it('should handle Windows-style backslash paths by resolving them', () => {
            // path.join uses the OS separator; on Windows this uses backslashes
            const winPath = projectRoot + path.sep + 'src' + path.sep + 'main.ts';
            expect(() => provider.validatePath(winPath)).not.toThrow();
        });
    });

    describe('isPathAllowed', () => {
        it('should return true for a path inside the project root', () => {
            const targetPath = path.join(projectRoot, 'src', 'index.ts');
            expect(provider.isPathAllowed(targetPath)).toBe(true);
        });

        it('should return false for a path outside the project root', () => {
            const outsidePath = path.join(os.homedir(), 'outside.txt');
            expect(provider.isPathAllowed(outsidePath)).toBe(false);
        });

        it('should return false for a path traversal attempt', () => {
            const traversalPath = path.join(projectRoot, '..', '..', 'etc', 'passwd');
            expect(provider.isPathAllowed(traversalPath)).toBe(false);
        });

        it('should return true for the project root itself', () => {
            expect(provider.isPathAllowed(projectRoot)).toBe(true);
        });
    });

    describe('getProjectRoot', () => {
        it('should return the resolved project root', () => {
            const resolvedRoot = path.resolve(projectRoot);
            expect(provider.getProjectRoot()).toBe(resolvedRoot);
        });
    });

    describe('edge cases', () => {
        it('should handle a project root with a trailing separator', () => {
            const rootWithSep = projectRoot + path.sep;
            const provider2 = new SecurityProvider(rootWithSep);
            const targetPath = path.join(projectRoot, 'file.ts');
            expect(provider2.isPathAllowed(targetPath)).toBe(true);
        });

        it('should be case-sensitive on POSIX, case-insensitive on win32 (H-7)', () => {
            // H-7: comparison is now platform-aware. On Linux (case-sensitive FS)
            // an uppercased root is a DIFFERENT directory and must be rejected;
            // on win32 it is the same directory and is allowed.
            const upperCasePath = projectRoot.toUpperCase() + path.sep + 'file.ts';
            if (process.platform === 'win32') {
                expect(provider.isPathAllowed(upperCasePath)).toBe(true);
            } else {
                expect(provider.isPathAllowed(upperCasePath)).toBe(false);
            }
        });

        it('H-7: should block a sibling directory sharing the root prefix', () => {
            // `<root>-secrets` shares the `<root>` string prefix but is NOT inside
            // the project. The old separator-less startsWith check let it through.
            const siblingPath = projectRoot + '-secrets' + path.sep + 'credentials.ts';
            expect(provider.isPathAllowed(siblingPath)).toBe(false);
            expect(() => provider.validatePath(siblingPath)).toThrow(CynapxError);
        });
    });
});

describe('isPathInside (H-7)', () => {
    const parent = path.join(os.tmpdir(), 'proj');

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns true for the parent itself (exact root)', () => {
        expect(isPathInside(parent, parent)).toBe(true);
    });

    it('returns true for a direct subdirectory', () => {
        expect(isPathInside(path.join(parent, 'src'), parent)).toBe(true);
    });

    it('returns true for a deeply nested descendant', () => {
        expect(isPathInside(path.join(parent, 'a', 'b', 'c.ts'), parent)).toBe(true);
    });

    it('returns false for a sibling sharing the prefix (proj-secrets vs proj)', () => {
        expect(isPathInside(parent + '-secrets', parent)).toBe(false);
        expect(isPathInside(path.join(parent + '-secrets', 'creds.ts'), parent)).toBe(false);
    });

    it('returns false for a `..` escape', () => {
        expect(isPathInside(path.join(parent, '..', 'other'), parent)).toBe(false);
        expect(isPathInside(path.join(parent, '..'), parent)).toBe(false);
    });

    it('returns false for a completely unrelated absolute path', () => {
        expect(isPathInside(path.join(os.homedir(), '.ssh', 'id_rsa'), parent)).toBe(false);
    });

    it('POSIX: differs by case → not inside (case-sensitive)', () => {
        vi.stubGlobal('process', { ...process, platform: 'linux' });
        expect(isPathInside(parent.toUpperCase(), parent)).toBe(false);
    });

    it('win32: differs by case → inside (case-insensitive)', () => {
        // Mock process.platform to win32. On a POSIX host path.relative still uses
        // POSIX semantics, but the case-folding branch under test is what matters:
        // identical paths differing only in case must be treated as the same.
        const origDesc = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            expect(isPathInside(parent.toUpperCase(), parent)).toBe(true);
            expect(isPathInside(path.join(parent, 'SUB').toUpperCase(), parent)).toBe(true);
        } finally {
            if (origDesc) Object.defineProperty(process, 'platform', origDesc);
        }
    });
});

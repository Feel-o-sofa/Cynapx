import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { SecurityProvider } from '../src/utils/security';
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

        it('should be case-insensitive in path comparison', () => {
            // The implementation lowercases both paths before comparing
            const upperCasePath = projectRoot.toUpperCase() + path.sep + 'file.ts';
            // path.resolve will not change the case, but the implementation normalizes to lowercase
            // so this should be allowed
            expect(provider.isPathAllowed(upperCasePath)).toBe(true);
        });
    });
});

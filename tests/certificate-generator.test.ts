/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 12-8: unit tests for CertificateGenerator
 * (diagnostic-v9 §5 "certificate-generator" test gap).
 *
 * child_process.execSync is mocked so no real openssl binary is required.
 * Covers:
 *   - success path (key/cert read back, temp files cleaned up)
 *   - openssl missing (ENOENT) → wrapped error, no temp files left behind
 *   - openssl non-zero exit after partial output → wrapped error + cleanup
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { CertificateGenerator } from '../src/utils/certificate-generator';

const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
    execSync: execSyncMock,
}));

/** Extracts the -keyout / -out temp file paths from the openssl command. */
function extractTempPaths(cmd: string): { keyPath: string; certPath: string } {
    const keyMatch = cmd.match(/-keyout "([^"]+)"/);
    const certMatch = cmd.match(/-out "([^"]+)"/);
    expect(keyMatch).not.toBeNull();
    expect(certMatch).not.toBeNull();
    return { keyPath: keyMatch![1], certPath: certMatch![1] };
}

beforeEach(() => {
    execSyncMock.mockReset();
});

describe('CertificateGenerator.generate', () => {
    it('returns key and cert buffers on success and removes the temp files', () => {
        execSyncMock.mockImplementation((cmd: string) => {
            const { keyPath, certPath } = extractTempPaths(cmd);
            fs.writeFileSync(keyPath, 'FAKE PRIVATE KEY');
            fs.writeFileSync(certPath, 'FAKE CERTIFICATE');
            return Buffer.from('');
        });

        const { key, cert } = CertificateGenerator.generate();
        expect(key.toString()).toBe('FAKE PRIVATE KEY');
        expect(cert.toString()).toBe('FAKE CERTIFICATE');

        // Temp files must be cleaned up immediately after a successful run.
        const cmd: string = execSyncMock.mock.calls[0][0];
        const { keyPath, certPath } = extractTempPaths(cmd);
        expect(fs.existsSync(keyPath)).toBe(false);
        expect(fs.existsSync(certPath)).toBe(false);
    });

    it('invokes openssl non-interactively with a 2048-bit key', () => {
        execSyncMock.mockImplementation((cmd: string) => {
            const { keyPath, certPath } = extractTempPaths(cmd);
            fs.writeFileSync(keyPath, 'k');
            fs.writeFileSync(certPath, 'c');
            return Buffer.from('');
        });
        CertificateGenerator.generate();

        const cmd: string = execSyncMock.mock.calls[0][0];
        expect(cmd).toMatch(/^openssl req /);
        expect(cmd).toContain('rsa:2048');
        expect(cmd).toContain('-nodes');   // no key passphrase prompt
        expect(cmd).toContain('-subj');    // no interactive subject prompt
    });

    it('throws a descriptive error when openssl is not installed (ENOENT)', () => {
        execSyncMock.mockImplementation(() => {
            const err: NodeJS.ErrnoException = new Error('spawnSync openssl ENOENT');
            err.code = 'ENOENT';
            throw err;
        });

        expect(() => CertificateGenerator.generate()).toThrow(
            /Failed to generate ephemeral SSL certificates/
        );

        // openssl never ran, so no temp files should exist (and cleanup must
        // not throw on the missing files).
        const cmd: string = execSyncMock.mock.calls[0][0];
        const { keyPath, certPath } = extractTempPaths(cmd);
        expect(fs.existsSync(keyPath)).toBe(false);
        expect(fs.existsSync(certPath)).toBe(false);
    });

    it('includes the underlying error in the wrapped message', () => {
        execSyncMock.mockImplementation(() => {
            throw new Error('spawnSync openssl ENOENT');
        });
        expect(() => CertificateGenerator.generate()).toThrow(/ENOENT/);
    });

    it('throws and cleans up partial output when openssl exits non-zero', () => {
        execSyncMock.mockImplementation((cmd: string) => {
            const { keyPath } = extractTempPaths(cmd);
            // Simulate openssl writing the key, then failing before the cert.
            fs.writeFileSync(keyPath, 'PARTIAL KEY');
            const err: any = new Error('Command failed: openssl req ... (exit code 1)');
            err.status = 1;
            throw err;
        });

        expect(() => CertificateGenerator.generate()).toThrow(
            /Failed to generate ephemeral SSL certificates/
        );

        // The partially written key file must be removed by the finally block.
        const cmd: string = execSyncMock.mock.calls[0][0];
        const { keyPath, certPath } = extractTempPaths(cmd);
        expect(fs.existsSync(keyPath)).toBe(false);
        expect(fs.existsSync(certPath)).toBe(false);
    });

    it('throws when openssl succeeds but output files are missing', () => {
        // execSync "succeeds" but produced nothing — readFileSync must fail
        // and be wrapped in the same descriptive error.
        execSyncMock.mockReturnValue(Buffer.from(''));
        expect(() => CertificateGenerator.generate()).toThrow(
            /Failed to generate ephemeral SSL certificates/
        );
    });

    it('uses unique temp file names per invocation (no collision between calls)', () => {
        const seen: string[] = [];
        execSyncMock.mockImplementation((cmd: string) => {
            const { keyPath, certPath } = extractTempPaths(cmd);
            seen.push(keyPath, certPath);
            fs.writeFileSync(keyPath, 'k');
            fs.writeFileSync(certPath, 'c');
            return Buffer.from('');
        });
        CertificateGenerator.generate();
        CertificateGenerator.generate();
        expect(new Set(seen).size).toBe(4);
    });
});

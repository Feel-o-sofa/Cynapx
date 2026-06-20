/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * H-9 (diagnostic-v10): `--https` failure must fail fast — never fall back
 * silently to plaintext HTTP. bootstrap.ts resolves the API server's TLS
 * options via resolveHttpsOptions() and exits(1) when it throws.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    resolveHttpsOptions,
    isLoopbackAddress,
    HttpsUnavailableError,
} from '../src/utils/https-options';

const TLS = { key: Buffer.from('key'), cert: Buffer.from('cert') };

describe('H-9: resolveHttpsOptions — no silent plaintext fallback', () => {
    it('throws HttpsUnavailableError when --https is requested and cert generation fails', () => {
        const generate = vi.fn(() => { throw new Error('openssl not found'); });

        // Pre-fix behaviour was `catch(e) { console.error(...) }` + plaintext
        // start — the helper must instead throw so bootstrap exits(1) and
        // never constructs an HTTP ApiServer.
        expect(() => resolveHttpsOptions(true, '0.0.0.0', generate))
            .toThrow(HttpsUnavailableError);
        expect(() => resolveHttpsOptions(true, '127.0.0.1', generate))
            .toThrow(/Refusing to fall back to plaintext HTTP/);
    });

    it('returns the generated TLS material when --https succeeds', () => {
        const generate = vi.fn(() => TLS);
        const resolved = resolveHttpsOptions(true, '127.0.0.1', generate);
        expect(resolved.httpsOptions).toBe(TLS);
        expect(resolved.warnings).toEqual([]);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('warns when plain HTTP is bound to a non-loopback address', () => {
        const generate = vi.fn(() => TLS);
        const resolved = resolveHttpsOptions(false, '0.0.0.0', generate);
        expect(resolved.httpsOptions).toBeUndefined();
        expect(resolved.warnings).toHaveLength(1);
        expect(resolved.warnings[0]).toMatch(/non-loopback/);
        expect(resolved.warnings[0]).toMatch(/--https/);
        // No certificate generation attempted for plain HTTP.
        expect(generate).not.toHaveBeenCalled();
    });

    it('does not warn for loopback binds over plain HTTP', () => {
        expect(resolveHttpsOptions(false, '127.0.0.1').warnings).toEqual([]);
        expect(resolveHttpsOptions(false, 'localhost').warnings).toEqual([]);
        expect(resolveHttpsOptions(false, '::1').warnings).toEqual([]);
    });
});

describe('H-9: isLoopbackAddress', () => {
    it.each([
        ['127.0.0.1', true],
        ['127.0.0.53', true],
        ['localhost', true],
        ['LOCALHOST', true],
        ['::1', true],
        ['[::1]', true],
        ['::ffff:127.0.0.1', true],
        ['0.0.0.0', false],
        ['::', false],
        ['192.168.0.10', false],
        ['10.0.0.1', false],
        ['example.com', false],
    ])('%s → %s', (addr, expected) => {
        expect(isLoopbackAddress(addr)).toBe(expected);
    });
});

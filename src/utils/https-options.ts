/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { CertificateGenerator } from './certificate-generator';

export interface TlsMaterial {
    key: Buffer;
    cert: Buffer;
}

export interface ResolvedHttpsOptions {
    /** TLS material for the API server; undefined = plain HTTP. */
    httpsOptions: TlsMaterial | undefined;
    /** Warnings the caller should surface (e.g. plaintext on non-loopback bind). */
    warnings: string[];
}

/**
 * H-9 (diagnostic-v10): thrown when `--https` was explicitly requested but
 * certificate generation failed. The caller MUST fail fast (exit) instead of
 * silently falling back to plaintext HTTP — combined with `--bind 0.0.0.0`
 * that would expose bearer tokens on the network.
 */
export class HttpsUnavailableError extends Error {
    constructor(cause: unknown) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        super(`--https was requested but SSL certificate generation failed: ${detail}. ` +
            `Refusing to fall back to plaintext HTTP.`);
        this.name = 'HttpsUnavailableError';
    }
}

/** Returns true for loopback-only bind addresses. */
export function isLoopbackAddress(addr: string): boolean {
    const a = (addr || '').toLowerCase();
    return a === 'localhost'
        || a === '::1'
        || a === '[::1]'
        || a.startsWith('127.')
        || a === '::ffff:127.0.0.1';
}

/**
 * H-9 (diagnostic-v10): resolves the API server's TLS options.
 *
 * - `--https` requested: generate an ephemeral certificate; on failure throw
 *   `HttpsUnavailableError` (fail-fast — NO silent plaintext fallback).
 * - `--https` not requested but bound to a non-loopback address: return a
 *   warning so the operator knows tokens travel unencrypted.
 *
 * @param generate injectable for tests; defaults to CertificateGenerator.
 */
export function resolveHttpsOptions(
    httpsRequested: boolean,
    bind: string,
    generate: () => TlsMaterial = () => CertificateGenerator.generate()
): ResolvedHttpsOptions {
    if (httpsRequested) {
        try {
            return { httpsOptions: generate(), warnings: [] };
        } catch (err) {
            throw new HttpsUnavailableError(err);
        }
    }

    const warnings: string[] = [];
    if (!isLoopbackAddress(bind)) {
        warnings.push(
            `[!] WARNING: REST API is bound to non-loopback address '${bind}' over plain HTTP — ` +
            `auth tokens travel unencrypted. Use --https.`
        );
    }
    return { httpsOptions: undefined, warnings };
}

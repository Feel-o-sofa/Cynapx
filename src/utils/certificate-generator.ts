/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * Generates self-signed certificates in memory for ephemeral HTTPS.
 * Uses system openssl and temporary files which are cleaned up immediately.
 */
export class CertificateGenerator {
    /**
     * Generates an ephemeral RSA 2048-bit key and self-signed certificate.
     * @returns Object containing key and cert as Buffers.
     */
    public static generate(): { key: Buffer; cert: Buffer } {
        const id = crypto.randomBytes(8).toString('hex');
        // O-8: openssl writes the private key with the process umask, so in a
        // world-readable tmpdir the key file is briefly readable by other local
        // users. Create a private 0700 directory first and do all key-file work
        // inside it, so the key is never exposed even momentarily.
        const workDir = path.join(os.tmpdir(), `cynapx-tls-${id}`);
        fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
        // mkdir mode is subject to umask; tighten explicitly to be safe.
        try { fs.chmodSync(workDir, 0o700); } catch { /* best-effort on platforms without chmod */ }

        const keyPath = path.join(workDir, 'key.pem');
        const certPath = path.join(workDir, 'cert.pem');

        try {
            // Generate certificate using openssl
            // -nodes: no password on the key
            // -subj: avoid interactive prompts
            const subj = "/C=KR/ST=Seoul/L=Seoul/O=Cynapx/OU=Ephemeral/CN=localhost";
            execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "${subj}"`, {
                stdio: 'ignore',
                windowsHide: true
            });

            const key = fs.readFileSync(keyPath);
            const cert = fs.readFileSync(certPath);

            return { key, cert };
        } catch (err) {
            throw new Error(`Failed to generate ephemeral SSL certificates: ${err}`);
        } finally {
            // Cleanup immediately — remove the whole private directory.
            if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
            if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
            try { fs.rmdirSync(workDir); } catch { /* directory may already be gone */ }
        }
    }
}

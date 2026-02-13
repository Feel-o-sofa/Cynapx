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
        const tempDir = os.tmpdir();
        const keyPath = path.join(tempDir, `cynapx-key-${id}.pem`);
        const certPath = path.join(tempDir, `cynapx-cert-${id}.pem`);

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
            // Cleanup immediately
            if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
            if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
        }
    }
}

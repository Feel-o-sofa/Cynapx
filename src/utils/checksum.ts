import * as crypto from 'crypto';
import * as fs from 'fs';

/**
 * Calculates a SHA-1 checksum of a file or string.
 */
export function calculateChecksum(data: string): string {
    return crypto.createHash('sha1').update(data).digest('hex');
}

export function calculateFileChecksum(filePath: string): string {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    return calculateChecksum(content);
}

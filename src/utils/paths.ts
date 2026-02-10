
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';

export function getCentralStorageDir(): string {
    const homeDir = os.homedir();
    const storageDir = path.join(homeDir, '.cynapx');
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }
    return storageDir;
}

export function getProjectHash(projectPath: string): string {
    // Normalize path to avoid different hashes for same directory due to slashes
    const normalizedPath = path.resolve(projectPath).toLowerCase();
    return crypto.createHash('md5').update(normalizedPath).digest('hex');
}

export function getDatabasePath(projectPath: string): string {
    const storageDir = getCentralStorageDir();
    const hash = getProjectHash(projectPath);
    return path.join(storageDir, `${hash}.db`);
}

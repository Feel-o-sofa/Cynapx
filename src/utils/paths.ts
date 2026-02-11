
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';

export const ANCHOR_FILE = '.cynapx-config';

export function getCentralStorageDir(): string {
    const homeDir = os.homedir();
    const storageDir = path.join(homeDir, '.cynapx');
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }
    return storageDir;
}

export function getRegistryPath(): string {
    return path.join(getCentralStorageDir(), 'registry.json');
}

export interface ProjectEntry {
    path: string;
    last_accessed: string;
}

export function readRegistry(): ProjectEntry[] {
    const registryPath = getRegistryPath();
    if (!fs.existsSync(registryPath)) return [];
    try {
        return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    } catch {
        return [];
    }
}

export function addToRegistry(projectPath: string): void {
    const absolutePath = path.resolve(projectPath);
    let registry = readRegistry();
    const index = registry.findIndex(p => p.path.toLowerCase() === absolutePath.toLowerCase());
    
    if (index !== -1) {
        registry[index].last_accessed = new Date().toISOString();
    } else {
        registry.push({ path: absolutePath, last_accessed: new Date().toISOString() });
    }
    
    fs.writeFileSync(getRegistryPath(), JSON.stringify(registry, null, 2), 'utf8');
}

export function findProjectAnchor(startPath: string): string | null {
    let current = path.resolve(startPath);
    while (true) {
        const anchorPath = path.join(current, ANCHOR_FILE);
        if (fs.existsSync(anchorPath)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
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

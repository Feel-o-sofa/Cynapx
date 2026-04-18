/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';

export const ANCHOR_FILE = '.cynapx-config';

/**
 * Known system directory prefixes that should never be registered as projects.
 * These are OS-managed directories (binaries, config, kernel interfaces) that
 * no user project should live inside. User-writable dirs like /tmp and /var
 * are intentionally excluded so that test fixtures and temp workspaces work.
 * Stored as lowercase for case-insensitive comparison.
 */
const SYSTEM_PATH_PREFIXES: string[] = [
    // Windows system directories
    path.normalize('C:\\Windows').toLowerCase(),
    path.normalize('C:\\Program Files').toLowerCase(),
    path.normalize('C:\\Program Files (x86)').toLowerCase(),
    // Unix / macOS OS-managed directories (not user-writable temp dirs)
    '/usr', '/bin', '/sbin', '/etc', '/lib', '/lib64',
    '/proc', '/sys', '/dev',
    '/system', '/library',
];

/**
 * Returns true if the given path is a known system/OS directory that should
 * never be treated as a user project root.
 */
export function isSystemPath(p: string): boolean {
    const normalized = path.resolve(p).toLowerCase().replace(/\\/g, '/');
    return SYSTEM_PATH_PREFIXES.some(sp => {
        const spNorm = sp.replace(/\\/g, '/');
        return normalized === spNorm || normalized.startsWith(spNorm + '/');
    });
}

export function getCentralStorageDir(): string {
    const homeDir = os.homedir();
    const storageDir = path.join(homeDir, '.cynapx');
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }
    return storageDir;
}

export function getLocksDir(): string {
    const locksDir = path.join(getCentralStorageDir(), 'locks');
    if (!fs.existsSync(locksDir)) {
        fs.mkdirSync(locksDir, { recursive: true });
    }
    return locksDir;
}

export function getRegistryPath(): string {
    return path.join(getCentralStorageDir(), 'registry.json');
}

export interface ProjectEntry {
    name: string;
    path: string;
    db_path: string;
    /** ISO timestamp of last completed index run */
    last_indexed_at?: string;
    last_accessed_at: string;
    /** Number of code nodes in the index at last index completion */
    node_count?: number;
    /** Number of edges in the index at last index completion */
    edge_count?: number;
    /** Cynapx version that produced the current index */
    cynapx_version?: string;
    /**
     * Health status — populated by `cynapx-admin doctor`.
     * 'ok' | 'stale' (DB file missing or project path gone)
     */
    status?: 'ok' | 'stale';
}

export function getProjectName(projectPath: string): string {
    return path.basename(projectPath);
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
    if (isSystemPath(absolutePath)) {
        throw new Error(`Refusing to register system path as a project: ${absolutePath}`);
    }
    const projectName = getProjectName(absolutePath);
    const dbPath = getDatabasePath(absolutePath);
    
    let registry = readRegistry();
    const index = registry.findIndex(p => p.path.toLowerCase() === absolutePath.toLowerCase());
    const now = new Date().toISOString();
    
    if (index !== -1) {
        const oldEntry = registry[index];
        registry[index] = { 
            name: projectName,
            path: absolutePath, 
            db_path: dbPath,
            last_indexed_at: oldEntry.last_indexed_at,
            last_accessed_at: now 
        };
    } else {
        registry.push({
            name: projectName,
            path: absolutePath, 
            db_path: dbPath,
            last_accessed_at: now 
        });
    }
    const registryPath = getRegistryPath();
    const tmpPath = registryPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), 'utf8');
    fs.renameSync(tmpPath, registryPath);
}

export function removeFromRegistry(projectPath: string): void {
    const absolutePath = path.resolve(projectPath);
    let registry = readRegistry();
    const newRegistry = registry.filter(p => p.path.toLowerCase() !== absolutePath.toLowerCase());
    if (registry.length !== newRegistry.length) {
        const registryPath = getRegistryPath();
        const tmpPath = registryPath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(newRegistry, null, 2), 'utf8');
        fs.renameSync(tmpPath, registryPath);
    }
}

/**
 * Updates the registry entry for a project with post-index statistics.
 * Called by WorkspaceManager after a successful indexing run.
 */
export function updateRegistryStats(
    projectPath: string,
    stats: { node_count: number; edge_count: number; cynapx_version: string }
): void {
    const absolutePath = path.resolve(projectPath);
    const registry = readRegistry();
    const index = registry.findIndex(p => p.path.toLowerCase() === absolutePath.toLowerCase());
    if (index === -1) return; // Not registered yet — addToRegistry will populate on next access

    const now = new Date().toISOString();
    registry[index] = {
        ...registry[index],
        last_indexed_at: now,
        node_count: stats.node_count,
        edge_count: stats.edge_count,
        cynapx_version: stats.cynapx_version,
        status: 'ok'
    };

    const registryPath = getRegistryPath();
    const tmpPath = registryPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), 'utf8');
    fs.renameSync(tmpPath, registryPath);
}

export function findProjectAnchor(startPath: string): string | null {
    let current = path.resolve(startPath);
    if (isSystemPath(current)) return null;

    const registry = readRegistry();
    const registeredProject = registry.find(p => current.toLowerCase().startsWith(p.path.toLowerCase()));
    if (registeredProject) return registeredProject.path;

    while (true) {
        if (isSystemPath(current)) break;
        const anchorPath = path.join(current, ANCHOR_FILE);
        if (fs.existsSync(anchorPath)) return current;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

export function getProjectHash(projectPath: string): string {
    const normalizedPath = path.resolve(projectPath).toLowerCase();
    return crypto.createHash('md5').update(normalizedPath).digest('hex');
}

export function getDatabasePath(projectPath: string): string {
    const storageDir = getCentralStorageDir();
    const hash = getProjectHash(projectPath);
    return path.join(storageDir, `${hash}_v2.db`);
}

export function toCanonical(s: string): string {
    if (!s) return '';
    let res = s.replace(/\\/g, '/');
    if (/^[a-zA-Z]:/.test(res)) {
        // Absolute
    } else if (res.startsWith('/') && !res.startsWith('//')) {
        const drive = path.parse(process.cwd()).root.replace(/\\/g, '/');
        res = path.join(drive, res).replace(/\\/g, '/');
    }
    return res.toLowerCase().replace(/\/+/g, '/').replace(/\/$/, '');
}

/** Default disk usage threshold in megabytes (1 GB). */
export const DISK_THRESHOLD_MB = 1024;

/**
 * Recursively compute total size of a directory tree in megabytes.
 * Returns 0 if the directory does not exist.
 */
export function getDirSizeMB(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let totalBytes = 0;
    function walk(d: string): void {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else {
                try {
                    totalBytes += fs.statSync(full).size;
                } catch { /* ignore */ }
            }
        }
    }
    walk(dir);
    return totalBytes / (1024 * 1024);
}

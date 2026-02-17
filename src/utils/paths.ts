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
    last_indexed_at?: string;
    last_accessed_at: string;
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
    fs.writeFileSync(getRegistryPath(), JSON.stringify(registry, null, 2), 'utf8');
}

export function removeFromRegistry(projectPath: string): void {
    const absolutePath = path.resolve(projectPath);
    let registry = readRegistry();
    const newRegistry = registry.filter(p => p.path.toLowerCase() !== absolutePath.toLowerCase());
    if (registry.length !== newRegistry.length) {
        fs.writeFileSync(getRegistryPath(), JSON.stringify(newRegistry, null, 2), 'utf8');
    }
}

export function findProjectAnchor(startPath: string): string | null {
    let current = path.resolve(startPath);
    const registry = readRegistry();
    const registeredProject = registry.find(p => current.toLowerCase().startsWith(p.path.toLowerCase()));
    if (registeredProject) return registeredProject.path;

    while (true) {
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
    return path.join(storageDir, `${hash}.db`);
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

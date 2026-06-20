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
/**
 * H-7: Returns true if `child` is the same path as `parent` or a true
 * descendant of it. Both paths are resolved to absolute first. Containment is
 * decided via `path.relative(parent, child)` — the result must NOT start with
 * `..` and must NOT itself be an absolute path. This avoids the separator-less
 * prefix-match bug where a sibling directory like `/proj-secrets` would pass a
 * naive `startsWith('/proj')` check.
 *
 * Case sensitivity is platform-dependent: win32 file systems are
 * case-insensitive (lowercase both before comparison); POSIX is case-sensitive.
 */
export function isPathInside(child: string, parent: string): boolean {
    let absChild = path.resolve(child);
    let absParent = path.resolve(parent);

    if (process.platform === 'win32') {
        absChild = absChild.toLowerCase();
        absParent = absParent.toLowerCase();
    }

    const rel = path.relative(absParent, absChild);
    // Same path → rel is '' (inside). Descendant → rel has no leading '..' and
    // is not absolute. Sibling/escape → rel starts with '..' or is absolute.
    return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

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

/**
 * A-8: read-modify-write the registry under a pid-based temp file with
 * retry-on-conflict. Multiple cynapx processes (e.g. several `initialize_project`
 * runs) can register concurrently; a FIXED temp filename (`registry.json.tmp`)
 * meant two writers clobbered each other's temp file, and a last-writer-wins
 * rename dropped the other's update (lost update).
 *
 * Each writer now (1) uses a unique `registry.json.<pid>.<rnd>.tmp` so temp
 * files never collide, and (2) re-reads the registry inside the loop and applies
 * `mutate` to the freshest copy, retrying if the on-disk registry changed
 * between the read and the rename. The rename itself is atomic on POSIX/NTFS.
 */
function updateRegistryAtomic(mutate: (registry: ProjectEntry[]) => ProjectEntry[] | null): void {
    const registryPath = getRegistryPath();
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const before = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : null;
        let registry: ProjectEntry[];
        try {
            registry = before ? JSON.parse(before) : [];
        } catch {
            registry = [];
        }

        const next = mutate(registry);
        if (next === null) return; // mutate signalled "no change needed"

        // Re-check that nobody else wrote between our read and now; if they did,
        // retry against the fresher copy (merge by re-running mutate).
        const current = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf8') : null;
        if (current !== before) continue; // conflict — retry with the new state

        const tmpPath = `${registryPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
        try {
            fs.renameSync(tmpPath, registryPath);
        } catch (e) {
            try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
            throw e;
        }
        return;
    }
    // Best-effort final write if we kept losing the race — apply to the latest.
    const registry = readRegistry();
    const next = mutate(registry);
    if (next === null) return;
    const tmpPath = `${registryPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmpPath, registryPath);
}

export function addToRegistry(projectPath: string): void {
    const absolutePath = path.resolve(projectPath);
    if (isSystemPath(absolutePath)) {
        throw new Error(`Refusing to register system path as a project: ${absolutePath}`);
    }
    const projectName = getProjectName(absolutePath);
    const dbPath = getDatabasePath(absolutePath);
    const now = new Date().toISOString();

    updateRegistryAtomic((registry) => {
        const index = registry.findIndex(p => p.path.toLowerCase() === absolutePath.toLowerCase());
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
        return registry;
    });
}

export function removeFromRegistry(projectPath: string): void {
    const absolutePath = path.resolve(projectPath);
    updateRegistryAtomic((registry) => {
        const newRegistry = registry.filter(p => p.path.toLowerCase() !== absolutePath.toLowerCase());
        if (registry.length === newRegistry.length) return null; // nothing removed
        return newRegistry;
    });
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
    const now = new Date().toISOString();
    updateRegistryAtomic((registry) => {
        const index = registry.findIndex(p => p.path.toLowerCase() === absolutePath.toLowerCase());
        if (index === -1) return null; // Not registered yet — addToRegistry will populate on next access
        registry[index] = {
            ...registry[index],
            last_indexed_at: now,
            node_count: stats.node_count,
            edge_count: stats.edge_count,
            cynapx_version: stats.cynapx_version,
            status: 'ok'
        };
        return registry;
    });
}

export function findProjectAnchor(startPath: string): string | null {
    let current = path.resolve(startPath);
    if (isSystemPath(current)) return null;

    const registry = readRegistry();
    const registeredProject = registry.find(p => isPathInside(current, p.path));
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

/**
 * A-8: case-sensitivity of the project-hash input is platform-dependent — the
 * same rule the H-7 isPathInside() boundary check uses. On case-insensitive
 * filesystems (win32, darwin) `/Proj` and `/proj` are the SAME directory, so we
 * lowercase before hashing to map them to one DB/lock. On case-sensitive POSIX
 * filesystems (Linux) they are DISTINCT projects, so hashing the path verbatim
 * keeps their DB/lock/profile separate. Previously the unconditional lowercase
 * collapsed genuinely distinct Linux projects onto a shared DB and lock.
 */
function isCaseInsensitiveFs(): boolean {
    return process.platform === 'win32' || process.platform === 'darwin';
}

export function getProjectHash(projectPath: string): string {
    const resolved = path.resolve(projectPath);
    const normalizedPath = isCaseInsensitiveFs() ? resolved.toLowerCase() : resolved;
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

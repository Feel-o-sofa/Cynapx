/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * O-3 + A-10: single source of truth for the package version.
 *
 * Previously the version was read from package.json in 5 different places
 * (bootstrap, mcp-server x2, workspace-manager x2, admin, api-server /healthz),
 * each re-reading and JSON-parsing the file. The /healthz path in particular
 * did a synchronous disk read on every request.
 *
 * This module reads package.json exactly once (lazily) and caches the result.
 */

const FALLBACK_VERSION = '0.0.0';

let _cached: string | undefined;

/**
 * Walk up from `dist/utils/` (or `src/utils/` under ts-node) looking for the
 * nearest package.json. Resolving by walking instead of a fixed `../../` makes
 * this robust to where the compiled file lands and to test runners.
 */
function locatePackageJson(): string | undefined {
    let dir = __dirname;
    // Bound the walk to avoid pathological loops on exotic mounts.
    for (let i = 0; i < 6; i++) {
        const candidate = path.join(dir, 'package.json');
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return undefined;
}

/**
 * Returns the package version, reading + caching package.json on first call.
 * Never throws — returns a fallback on any failure.
 */
export function getVersion(): string {
    if (_cached !== undefined) return _cached;
    try {
        const pkgPath = locatePackageJson();
        if (pkgPath) {
            const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
            _cached = parsed.version ?? FALLBACK_VERSION;
            return _cached;
        }
    } catch {
        // fall through to fallback
    }
    _cached = FALLBACK_VERSION;
    return _cached;
}

/** Test-only: reset the memoised value so a fresh read can be observed. */
export function _resetVersionCacheForTests(): void {
    _cached = undefined;
}

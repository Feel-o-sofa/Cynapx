/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getCentralStorageDir, getProjectHash } from './paths';

/**
 * Per-project indexing and analysis configuration.
 * Stored at ~/.cynapx/profiles/{hash}.json.
 */
export interface ProjectProfile {
    /** Glob patterns (minimatch-compatible) to exclude from indexing. */
    excludePatterns?: string[];
    /** Maximum file size in bytes to index (default: 500KB) */
    maxFileSize?: number;
    /**
     * Language overrides: map of file extension → parser id.
     * e.g. { ".mts": "typescript", ".cts": "typescript" }
     */
    languageOverrides?: Record<string, string>;
    /**
     * Optional webhook URL to POST when indexing completes or errors.
     * Populated here for documentation; A-6 will wire up the actual call.
     */
    webhookUrl?: string;
}

const DEFAULT_PROFILE: Required<Omit<ProjectProfile, 'webhookUrl'>> = {
    excludePatterns: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    maxFileSize: 500 * 1024,
    languageOverrides: {}
};

function getProfilesDir(): string {
    const dir = path.join(getCentralStorageDir(), 'profiles');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function getProfilePath(projectPath: string): string {
    const hash = getProjectHash(projectPath);
    return path.join(getProfilesDir(), `${hash}.json`);
}

/**
 * Loads the profile for a project, merging with defaults.
 * Returns defaults if no profile file exists.
 */
export function loadProfile(projectPath: string): ProjectProfile {
    const profilePath = getProfilePath(projectPath);
    if (!fs.existsSync(profilePath)) {
        return { ...DEFAULT_PROFILE };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(profilePath, 'utf8')) as ProjectProfile;
        return {
            excludePatterns: raw.excludePatterns ?? DEFAULT_PROFILE.excludePatterns,
            maxFileSize: raw.maxFileSize ?? DEFAULT_PROFILE.maxFileSize,
            languageOverrides: raw.languageOverrides ?? DEFAULT_PROFILE.languageOverrides,
            webhookUrl: raw.webhookUrl
        };
    } catch {
        return { ...DEFAULT_PROFILE };
    }
}

/**
 * Saves (or updates) the profile for a project.
 * Uses atomic write to prevent partial-write corruption.
 */
export function saveProfile(projectPath: string, profile: ProjectProfile): void {
    const profilePath = getProfilePath(projectPath);
    const tmpPath = profilePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(profile, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, profilePath);
}

/**
 * Returns the filesystem path where the profile would be stored.
 * Used for CLI display and testing.
 */
export function resolveProfilePath(projectPath: string): string {
    return getProfilePath(projectPath);
}

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { simpleGit, SimpleGit } from 'simple-git';

/**
 * H-3: Thrown when a `git diff` command itself fails (e.g. the from-commit no
 * longer exists after a rebase/force-push/shallow fetch). This is distinct from
 * a successful diff that simply reports no changes — callers must be able to
 * tell "nothing changed" apart from "the diff range is invalid" so they can
 * fall back to a full scan and recover the watermark instead of stalling.
 */
export class DiffFailedError extends Error {
    constructor(public readonly from: string, public readonly to: string, cause?: unknown) {
        super(`git diff ${from}..${to} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = 'DiffFailedError';
    }
}

/**
 * GitService provides information about git commits for files.
 */
export class GitService {
    private git: SimpleGit;

    constructor(basePath: string) {
        this.git = simpleGit(basePath);
    }

    /**
     * Returns the latest commit SHA for a given file.
     */
    public async getLatestCommit(filePath: string): Promise<string> {
        try {
            const log = await this.git.log({ file: filePath, maxCount: 1 });
            return log.latest?.hash || 'unknown';
        } catch (error) {
            console.warn(`Could not get git log for ${filePath}:`, error);
            return 'not-in-git';
        }
    }

    /**
     * Returns the author timestamp of a commit.
     */
    public async getCommitDate(hash: string): Promise<number> {
        if (hash === 'unknown' || hash === 'not-in-git' || hash === 'deleted') return 0;
        try {
            const dateStr = await this.git.show(['-s', '--format=%at', hash]);
            return parseInt(dateStr.trim()) * 1000; // Convert to ms
        } catch {
            return 0;
        }
    }

    /**
     * O-2: Builds a map of repo-relative file path → latest commit hash for the
     * whole repository in a *single* `git log --name-only` pass, instead of one
     * `git log` subprocess per file. Walking commits newest-first, the first
     * commit that touches a file is its latest commit; later (older) commits for
     * the same file are ignored. Returns repo-relative paths exactly as git
     * prints them (callers resolve them against the project root).
     */
    public async getLatestCommitsForFiles(): Promise<Map<string, string>> {
        const latest = new Map<string, string>();
        try {
            // %x00 = NUL after the hash so a "<hash>\0<file>\n<file>\n..." block
            // per commit is unambiguous regardless of file path contents.
            const raw = await this.git.raw([
                'log',
                '--name-only',
                '--no-renames',
                '--pretty=format:%x01%H',
            ]);
            let currentHash = '';
            for (const line of raw.split('\n')) {
                if (line.startsWith('\x01')) {
                    currentHash = line.slice(1).trim();
                    continue;
                }
                const file = line.trim();
                if (!file || !currentHash) continue;
                // Newest-first: keep the first hash seen for each file.
                if (!latest.has(file)) latest.set(file, currentHash);
            }
        } catch (error) {
            console.warn('Could not build latest-commit map via git log --name-only:', error);
        }
        return latest;
    }

    /**
     * H-3: Returns true if the given commit-ish exists in the repository.
     * Used to detect a from-commit that was rewritten away (rebase/force-push)
     * before attempting a diff that would otherwise fail opaquely.
     */
    public async commitExists(ref: string): Promise<boolean> {
        if (!ref) return false;
        try {
            await this.git.raw(['cat-file', '-e', `${ref}^{commit}`]);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Returns the current HEAD commit hash.
     */
    public async getCurrentHead(): Promise<string> {
        try {
            const rev = await this.git.revparse(['HEAD']);
            return rev.trim();
        } catch (error) {
            console.error('Failed to get current Git HEAD:', error);
            return 'unknown';
        }
    }

    /**
     * Returns the list of changed files between two commits.
     *
     * H-3: Uses `--name-status -z` (NUL-delimited) so file paths containing
     * spaces, tabs, or other whitespace are parsed correctly — the old
     * `line.split(/\s+/)` parsing corrupted such paths. A genuinely empty diff
     * returns `[]`; a *failed* diff (e.g. the from-commit was rewritten away)
     * throws {@link DiffFailedError} so callers can fall back to a full scan
     * instead of mistaking failure for "no changes" and stalling forever.
     */
    public async getDiffFiles(from: string, to: string): Promise<{ file: string, status: string }[]> {
        let raw: string;
        try {
            raw = await this.git.raw(['diff', '--name-status', '-z', `${from}..${to}`]);
        } catch (error) {
            console.error(`Failed to get diff between ${from} and ${to}:`, error);
            throw new DiffFailedError(from, to, error);
        }

        // -z output is NUL-separated. For A/M/D each record is two fields:
        //   <status>\0<path>\0
        // For renames/copies (R###/C###) it is three fields:
        //   <status>\0<oldPath>\0<newPath>\0
        const tokens = raw.split('\0').filter(t => t.length > 0);
        const results: { file: string, status: string }[] = [];
        let i = 0;
        while (i < tokens.length) {
            const statusField = tokens[i++];
            const statusChar = statusField[0]; // A, M, D, R, C, T, ...
            if (statusChar === 'R' || statusChar === 'C') {
                // Rename/Copy: consume old + new path.
                const oldPath = tokens[i++];
                const newPath = tokens[i++];
                if (statusChar === 'R') {
                    results.push({ file: oldPath, status: 'DELETE' });
                }
                results.push({ file: newPath, status: 'ADD' });
                continue;
            }

            const file = tokens[i++];
            if (file === undefined) break;
            let event: string = 'MODIFY';
            if (statusChar === 'A') event = 'ADD';
            else if (statusChar === 'D') event = 'DELETE';
            results.push({ file, status: event });
        }
        return results;
    }

    /**
     * Returns all files currently tracked by git (git ls-files).
     * Used for full initial indexing when no previous indexed commit exists.
     */
    public async getAllTrackedFiles(): Promise<string[]> {
        try {
            const raw = await this.git.raw(['ls-files']);
            return raw.split('\n').map(f => f.trim()).filter(f => f.length > 0);
        } catch (error) {
            console.error('Failed to list tracked files:', error);
            return [];
        }
    }

    /**
     * Returns the commit history for a specific file.
     */
    public async getHistoryForFile(filePath: string, limit: number = 5): Promise<any[]> {
        try {
            const log = await this.git.log({ file: filePath, maxCount: limit });
            return log.all.map(commit => ({
                hash: commit.hash,
                message: commit.message,
                author: commit.author_name,
                date: commit.date
            }));
        } catch (error) {
            console.error(`Failed to get history for ${filePath}:`, error);
            return [];
        }
    }
}

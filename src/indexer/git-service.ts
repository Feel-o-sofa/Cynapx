/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { simpleGit, SimpleGit } from 'simple-git';

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
     */
    public async getDiffFiles(from: string, to: string): Promise<{ file: string, status: string }[]> {
        try {
            const raw = await this.git.diff(['--name-status', `${from}..${to}`]);
            const lines = raw.split('\n').filter(line => line.trim().length > 0);
            return lines.flatMap(line => {
                const parts = line.split(/\s+/);
                const statusChar = parts[0][0]; // A, M, D, R, etc.

                if (statusChar === 'R' && parts.length >= 3) {
                    // Rename: return DELETE for old path + ADD for new path
                    return [
                        { file: parts[1], status: 'DELETE' },
                        { file: parts[2], status: 'ADD' }
                    ];
                }

                const file = parts[parts.length - 1];
                let event: string = 'MODIFY';
                if (statusChar === 'A') event = 'ADD';
                else if (statusChar === 'D') event = 'DELETE';

                return [{ file, status: event }];
            });
        } catch (error) {
            console.error(`Failed to get diff between ${from} and ${to}:`, error);
            return [];
        }
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

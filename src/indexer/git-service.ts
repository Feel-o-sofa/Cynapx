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
            return lines.map(line => {
                const parts = line.split(/\s+/);
                const statusChar = parts[0][0]; // A, M, D, R, etc.
                const file = parts[parts.length - 1]; // Handles renames if necessary, but keep it simple
                
                let event: string = 'MODIFY';
                if (statusChar === 'A') event = 'ADD';
                else if (statusChar === 'D') event = 'DELETE';
                else if (statusChar === 'M' || statusChar === 'R') event = 'MODIFY';

                return { file, status: event };
            });
        } catch (error) {
            console.error(`Failed to get diff between ${from} and ${to}:`, error);
            return [];
        }
    }
}

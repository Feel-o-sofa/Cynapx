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
}

import * as path from 'path';
import { GitService } from '../git-service';
import { SyncStrategy, SyncResult, FileIndexEvent } from './sync-strategy';
import { ChangeType } from '../types';

/**
 * Full-scan strategy: used when there is no prior indexed commit (fresh DB).
 * Enumerates every file tracked by git and treats each as an ADD event.
 */
export class FullScanStrategy implements SyncStrategy {
  constructor(private readonly gitService: GitService) {}

  async buildEvents(projectPath: string): Promise<SyncResult | null> {
    const head = await this.gitService.getCurrentHead();
    const allFiles = await this.gitService.getAllTrackedFiles();
    if (allFiles.length === 0) return null;

    // O-2: resolve every file's latest commit in a single `git log --name-only`
    // pass instead of one `git log` subprocess per file (previously near-serial
    // due to simple-git's default concurrency of 5).
    const latestCommits = await this.gitService.getLatestCommitsForFiles();

    const events: FileIndexEvent[] = allFiles.map((f) => {
      const fullPath = path.resolve(projectPath, f);
      // git prints repo-relative paths; the latest-commit map is keyed the same way.
      const commit = latestCommits.get(f) ?? head;
      return { event: 'ADD' as ChangeType, file_path: fullPath, commit };
    });

    return { events, head };
  }
}

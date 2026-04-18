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

    const events: FileIndexEvent[] = await Promise.all(
      allFiles.map(async (f) => {
        const fullPath = path.resolve(projectPath, f);
        const commit = await this.gitService.getLatestCommit(fullPath).catch(() => head);
        return { event: 'ADD' as ChangeType, file_path: fullPath, commit };
      })
    );

    return { events, head };
  }
}

import * as path from 'path';
import { GitService } from '../git-service';
import { SyncStrategy, SyncResult, FileIndexEvent } from './sync-strategy';
import { ChangeType } from '../types';

/**
 * Incremental strategy: used when there is a known last-indexed commit.
 * Only processes files that changed between that commit and HEAD.
 */
export class IncrementalSyncStrategy implements SyncStrategy {
  constructor(
    private readonly gitService: GitService,
    private readonly lastCommit: string,
    private readonly currentHead: string
  ) {}

  async buildEvents(projectPath: string): Promise<SyncResult | null> {
    const diffs = await this.gitService.getDiffFiles(this.lastCommit, this.currentHead);
    if (diffs.length === 0) return null;

    const events = await Promise.all(
      diffs.map(async (d) => {
        const fullPath = path.resolve(projectPath, d.file);
        const commit =
          d.status === 'DELETE'
            ? 'deleted'
            : await this.gitService.getLatestCommit(fullPath);
        return { event: d.status as ChangeType, file_path: fullPath, commit };
      })
    );

    return { events, head: this.currentHead };
  }
}

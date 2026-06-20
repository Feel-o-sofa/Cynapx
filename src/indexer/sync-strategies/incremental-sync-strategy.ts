import * as path from 'path';
import { GitService } from '../git-service';
import { SyncStrategy, SyncResult, FileIndexEvent } from './sync-strategy';
import { ChangeType } from '../types';

/**
 * Incremental strategy: used when there is a known last-indexed commit.
 * Only processes files that changed between that commit and HEAD.
 *
 * H-3: getDiffFiles() now throws DiffFailedError when the diff command itself
 * fails (e.g. the from-commit was rewritten away). buildEvents() lets that
 * error propagate so syncWithGit() can fall back to a FullScanStrategy and
 * recover the watermark, instead of swallowing it and stalling forever.
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

    // O-2: build the latest-commit map for the whole repo in one pass instead
    // of one `git log` per changed file.
    const latestCommits = await this.gitService.getLatestCommitsForFiles();

    const events: FileIndexEvent[] = diffs.map((d) => {
      const fullPath = path.resolve(projectPath, d.file);
      const commit =
        d.status === 'DELETE'
          ? 'deleted'
          : latestCommits.get(d.file) ?? this.currentHead;
      return { event: d.status as ChangeType, file_path: fullPath, commit };
    });

    return { events, head: this.currentHead };
  }
}

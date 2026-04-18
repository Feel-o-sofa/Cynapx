import { describe, it, expect, vi } from 'vitest';
import { FullScanStrategy } from '../src/indexer/sync-strategies/full-scan-strategy';
import { IncrementalSyncStrategy } from '../src/indexer/sync-strategies/incremental-sync-strategy';
import type { GitService } from '../src/indexer/git-service';

function mockGit(overrides: Partial<Record<keyof GitService, unknown>> = {}): GitService {
  return {
    getCurrentHead: vi.fn().mockResolvedValue('abc123'),
    getAllTrackedFiles: vi.fn().mockResolvedValue([]),
    getLatestCommit: vi.fn().mockResolvedValue('abc123'),
    getDiffFiles: vi.fn().mockResolvedValue([]),
    getHistoryForFile: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as GitService;
}

describe('FullScanStrategy', () => {
  it('returns null when getAllTrackedFiles is empty', async () => {
    const git = mockGit({ getAllTrackedFiles: vi.fn().mockResolvedValue([]) });
    const strategy = new FullScanStrategy(git);
    const result = await strategy.buildEvents('/project');
    expect(result).toBeNull();
  });

  it('returns ADD events for each tracked file', async () => {
    const git = mockGit({
      getCurrentHead: vi.fn().mockResolvedValue('head1'),
      getAllTrackedFiles: vi.fn().mockResolvedValue(['src/a.ts', 'src/b.ts']),
      getLatestCommit: vi.fn().mockResolvedValue('commit1'),
    });
    const strategy = new FullScanStrategy(git);
    const result = await strategy.buildEvents('/project');
    expect(result).not.toBeNull();
    expect(result!.head).toBe('head1');
    expect(result!.events).toHaveLength(2);
    expect(result!.events[0].event).toBe('ADD');
    expect(result!.events[1].event).toBe('ADD');
  });

  it('falls back to HEAD commit when getLatestCommit rejects', async () => {
    const git = mockGit({
      getCurrentHead: vi.fn().mockResolvedValue('fallback-head'),
      getAllTrackedFiles: vi.fn().mockResolvedValue(['src/a.ts']),
      getLatestCommit: vi.fn().mockRejectedValue(new Error('git error')),
    });
    const strategy = new FullScanStrategy(git);
    const result = await strategy.buildEvents('/project');
    expect(result!.events[0].commit).toBe('fallback-head');
  });
});

describe('IncrementalSyncStrategy', () => {
  it('returns null when getDiffFiles is empty', async () => {
    const git = mockGit({ getDiffFiles: vi.fn().mockResolvedValue([]) });
    const strategy = new IncrementalSyncStrategy(git, 'old-hash', 'new-hash');
    const result = await strategy.buildEvents('/project');
    expect(result).toBeNull();
  });

  it('returns correct events for ADD and DELETE diffs', async () => {
    const git = mockGit({
      getDiffFiles: vi.fn().mockResolvedValue([
        { file: 'src/a.ts', status: 'ADD' },
        { file: 'src/b.ts', status: 'DELETE' },
      ]),
      getLatestCommit: vi.fn().mockResolvedValue('new-commit'),
    });
    const strategy = new IncrementalSyncStrategy(git, 'old', 'new-hash');
    const result = await strategy.buildEvents('/project');
    expect(result).not.toBeNull();
    expect(result!.head).toBe('new-hash');
    expect(result!.events).toHaveLength(2);
    expect(result!.events[0].event).toBe('ADD');
    expect(result!.events[0].commit).toBe('new-commit');
    expect(result!.events[1].event).toBe('DELETE');
    expect(result!.events[1].commit).toBe('deleted');
  });
});

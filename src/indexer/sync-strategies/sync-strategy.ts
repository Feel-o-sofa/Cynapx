import { ChangeType } from '../types';

export interface FileIndexEvent {
  event: ChangeType;
  file_path: string;
  commit: string;
}

export interface SyncResult {
  events: FileIndexEvent[];
  head: string;
}

export interface SyncStrategy {
  /** Returns null if there is nothing to sync. */
  buildEvents(projectPath: string): Promise<SyncResult | null>;
}

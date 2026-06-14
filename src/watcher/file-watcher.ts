/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as chokidar from 'chokidar';
import { UpdatePipeline } from '../indexer/update-pipeline';
import { ChangeType } from '../indexer/types';
import { Disposable } from '../types';
import { LanguageRegistry } from '../indexer/language-registry';
import { FileFilter } from '../utils/file-filter';
import { ProjectProfile } from '../utils/profile';
import { Logger } from '../utils/logger';


const log = new Logger('FileWatcher');
// H-2: Extensions handled by metadata parsers (CompositeParser) that are not
// part of LanguageRegistry's tree-sitter providers, but should still trigger
// re-indexing on change.
const METADATA_EXTENSIONS = ['yaml', 'yml', 'md', 'mdx', 'json', 'jsonc'];

/**
 * FileWatcher monitors the file system for changes and triggers the update pipeline.
 */
export class FileWatcher implements Disposable {
    private watcher: chokidar.FSWatcher | null = null;
    private queue: { event: ChangeType, path: string }[] = [];
    private timer: NodeJS.Timeout | null = null;
    private readonly BATCH_THRESHOLD = 50;
    private readonly BATCH_WINDOW_MS = 1000;
    private syncFailedCount = 0;
    private static readonly MAX_SYNC_RETRIES = 3;
    // H-3: guards against concurrent flush()/syncWithGit() runs.
    private flushing = false;
    private readonly watchedExtensions: Set<string>;
    // A-6: .gitignore-aware (+ profile excludePatterns/maxFileSize) filter so the
    // watcher ignores the same files the indexer's discovery (ConsistencyChecker)
    // ignores — gitignored build output (dist/, build/) no longer leaks into the
    // index via edits and desync git-based sync.
    private readonly fileFilter: FileFilter;

    constructor(
        private pipeline: UpdatePipeline,
        private projectPath: string,
        profile?: ProjectProfile
    ) {
        this.watchedExtensions = new Set([
            ...LanguageRegistry.getInstance().getAllExtensions(),
            ...METADATA_EXTENSIONS,
        ]);
        this.fileFilter = new FileFilter(this.projectPath, {
            excludePatterns: profile?.excludePatterns,
            maxFileSize: profile?.maxFileSize,
        });
    }

    /**
     * Starts watching the target directory.
     */
    public start(watchPath: string): void {
        log.info(`Starting file watcher on: ${watchPath}`);

        // A-6: .gitignore-aware ignore predicate. chokidar invokes this for both
        // directories (during traversal — so gitignored trees like dist/ are
        // pruned, not just filtered per-event) and files. Keep the dotfile rule
        // as a cheap first check, then defer to FileFilter (pattern-level only —
        // no fs.stat here; chokidar passes stats separately and unlink paths may
        // not exist). Per-file size limits are enforced in handleChange().
        const dotfileRe = /(^|[\/\\])\../;
        this.watcher = chokidar.watch(watchPath, {
            ignored: (testPath: string) => {
                if (dotfileRe.test(testPath)) return true;
                return this.fileFilter.isIgnored(testPath);
            },
            persistent: true,
            ignoreInitial: true // Initial scan is handled separately in bootstrap
        });

        this.watcher
            .on('add', (path) => this.handleChange('ADD', path))
            .on('change', (path) => this.handleChange('MODIFY', path))
            .on('unlink', (path) => this.handleChange('DELETE', path));

        log.info('File watcher is active.');
    }

    private handleChange(event: ChangeType, filePath: string): void {
        const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
        if (!this.watchedExtensions.has(ext)) return;

        // A-6: defence-in-depth — chokidar's `ignored` predicate already prunes
        // gitignored paths, but re-check (and enforce the profile's maxFileSize)
        // here too. The size check is skipped for DELETE since the file is gone.
        if (event === 'DELETE') {
            if (this.fileFilter.isIgnored(filePath)) return;
        } else if (this.fileFilter.shouldIgnoreFile(filePath)) {
            return;
        }

        this.queue.push({ event, path: filePath });

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.queue.length >= this.BATCH_THRESHOLD) {
            void this.flush();
        } else {
            // H1: null the handle inside the callback BEFORE flushing. If the
            // timer fires while a flush is in-flight (flush() early-returns on
            // the `flushing` guard), `this.timer` must not keep holding the
            // stale fired handle — otherwise the post-flush re-scheduler sees
            // a truthy timer and never schedules a follow-up flush, stranding
            // queued events.
            this.timer = setTimeout(() => {
                this.timer = null;
                void this.flush();
            }, this.BATCH_WINDOW_MS);
        }
    }

    private async flush(): Promise<void> {
        // H-3: if a flush is already running, let the in-flight run pick up
        // newly queued events afterwards rather than racing on this.queue.
        if (this.flushing) return;
        if (this.queue.length === 0) return;

        this.flushing = true;
        try {
            const currentQueue = [...this.queue];
            this.queue = [];
            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
            }

            if (currentQueue.length >= this.BATCH_THRESHOLD || this.syncFailedCount > 0) {
                if (this.syncFailedCount > 0) {
                    log.info(`Retrying failed Git sync (attempt after ${this.syncFailedCount} failure(s))...`);
                } else {
                    log.info(`Large change detected (${currentQueue.length} files). Triggering Git sync instead of individual processing.`);
                }
                try {
                    await this.pipeline.syncWithGit(this.projectPath);
                    this.syncFailedCount = 0;
                } catch (error) {
                    this.syncFailedCount++;
                    if (this.syncFailedCount >= FileWatcher.MAX_SYNC_RETRIES) {
                        log.error(`[ERROR] Git sync has failed ${this.syncFailedCount} consecutive time(s) — index may be inconsistent. Manual intervention may be required.`, { detail: error });
                    } else {
                        log.error(`Error during Git-based catch-up from watcher (failure ${this.syncFailedCount}/${FileWatcher.MAX_SYNC_RETRIES}):`, { detail: error });
                    }
                }
            } else {
                log.info(`Processing ${currentQueue.length} buffered file changes...`);
                try {
                    const events = currentQueue.map(q => ({
                        event: q.event,
                        file_path: q.path,
                        commit: 'watcher-change'
                    }));
                    await this.pipeline.processBatch(events, Date.now());
                } catch (error) {
                    log.error(`Error processing buffered watcher events:`, { detail: error });
                }
            }
        } finally {
            this.flushing = false;
        }

        // H-3: process any events queued while this flush was running.
        if (this.queue.length === 0) return;
        if (this.queue.length >= this.BATCH_THRESHOLD || this.syncFailedCount > 0) {
            void this.flush();
        } else {
            // H1: unconditionally reschedule. A timer that fired during the
            // in-flight flush would otherwise leave a stale handle behind.
            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(() => {
                this.timer = null;
                void this.flush();
            }, this.BATCH_WINDOW_MS);
        }
    }

    /**
     * Stops the watcher.
     */
    public dispose(): void {
        // M-8: Clear the flush timer before stopping to prevent post-dispose callbacks
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
}


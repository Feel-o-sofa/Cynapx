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

    constructor(
        private pipeline: UpdatePipeline,
        private projectPath: string
    ) {
        this.watchedExtensions = new Set([
            ...LanguageRegistry.getInstance().getAllExtensions(),
            ...METADATA_EXTENSIONS,
        ]);
    }

    /**
     * Starts watching the target directory.
     */
    public start(watchPath: string): void {
        console.log(`Starting file watcher on: ${watchPath}`);

        this.watcher = chokidar.watch(watchPath, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true,
            ignoreInitial: true // Initial scan is handled separately in bootstrap
        });

        this.watcher
            .on('add', (path) => this.handleChange('ADD', path))
            .on('change', (path) => this.handleChange('MODIFY', path))
            .on('unlink', (path) => this.handleChange('DELETE', path));

        console.log('File watcher is active.');
    }

    private handleChange(event: ChangeType, filePath: string): void {
        const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
        if (!this.watchedExtensions.has(ext)) return;

        this.queue.push({ event, path: filePath });

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.queue.length >= this.BATCH_THRESHOLD) {
            void this.flush();
        } else {
            this.timer = setTimeout(() => void this.flush(), this.BATCH_WINDOW_MS);
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
                    console.log(`Retrying failed Git sync (attempt after ${this.syncFailedCount} failure(s))...`);
                } else {
                    console.log(`Large change detected (${currentQueue.length} files). Triggering Git sync instead of individual processing.`);
                }
                try {
                    await this.pipeline.syncWithGit(this.projectPath);
                    this.syncFailedCount = 0;
                } catch (error) {
                    this.syncFailedCount++;
                    if (this.syncFailedCount >= FileWatcher.MAX_SYNC_RETRIES) {
                        console.error(`[ERROR] Git sync has failed ${this.syncFailedCount} consecutive time(s) — index may be inconsistent. Manual intervention may be required.`, error);
                    } else {
                        console.error(`Error during Git-based catch-up from watcher (failure ${this.syncFailedCount}/${FileWatcher.MAX_SYNC_RETRIES}):`, error);
                    }
                }
            } else {
                console.log(`Processing ${currentQueue.length} buffered file changes...`);
                try {
                    const events = currentQueue.map(q => ({
                        event: q.event,
                        file_path: q.path,
                        commit: 'watcher-change'
                    }));
                    await this.pipeline.processBatch(events, Date.now());
                } catch (error) {
                    console.error(`Error processing buffered watcher events:`, error);
                }
            }
        } finally {
            this.flushing = false;
        }

        // H-3: process any events queued while this flush was running.
        if (this.queue.length === 0) return;
        if (this.queue.length >= this.BATCH_THRESHOLD || this.syncFailedCount > 0) {
            void this.flush();
        } else if (!this.timer) {
            this.timer = setTimeout(() => void this.flush(), this.BATCH_WINDOW_MS);
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


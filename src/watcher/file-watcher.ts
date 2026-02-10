import * as chokidar from 'chokidar';
import { UpdatePipeline } from '../indexer/update-pipeline';
import { ChangeType } from '../indexer/types';

/**
 * FileWatcher monitors the file system for changes and triggers the update pipeline.
 */
export class FileWatcher {
    private watcher: chokidar.FSWatcher | null = null;
    private queue: { event: ChangeType, path: string }[] = [];
    private timer: NodeJS.Timeout | null = null;
    private readonly BATCH_THRESHOLD = 50;
    private readonly BATCH_WINDOW_MS = 1000;

    constructor(
        private pipeline: UpdatePipeline,
        private projectPath: string
    ) { }

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
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.js') && !filePath.endsWith('.py')) return;

        this.queue.push({ event, path: filePath });

        if (this.timer) clearTimeout(this.timer);

        if (this.queue.length >= this.BATCH_THRESHOLD) {
            this.flush();
        } else {
            this.timer = setTimeout(() => this.flush(), this.BATCH_WINDOW_MS);
        }
    }

    private async flush(): Promise<void> {
        if (this.queue.length === 0) return;

        const currentQueue = [...this.queue];
        this.queue = [];
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (currentQueue.length >= this.BATCH_THRESHOLD) {
            console.log(`Large change detected (${currentQueue.length} files). Triggering Git sync instead of individual processing.`);
            try {
                await this.pipeline.syncWithGit(this.projectPath);
            } catch (error) {
                console.error('Error during Git-based catch-up from watcher:', error);
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
    }

    /**
     * Stops the watcher.
     */
    public stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
}


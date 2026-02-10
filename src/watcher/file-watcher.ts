import * as chokidar from 'chokidar';
import { UpdatePipeline } from '../indexer/update-pipeline';
import { ChangeType } from '../indexer/types';

/**
 * FileWatcher monitors the file system for changes and triggers the update pipeline.
 */
export class FileWatcher {
    private watcher: chokidar.FSWatcher | null = null;

    constructor(private pipeline: UpdatePipeline) { }

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

    private async handleChange(event: ChangeType, filePath: string): Promise<void> {
        if (!filePath.endsWith('.ts') && !filePath.endsWith('.js')) return;

        console.log(`File change detected: ${event} ${filePath}`);
        try {
            await this.pipeline.processChangeEvent({
                event,
                file_path: filePath,
                commit: 'watcher-change'
            }, Date.now());
        } catch (error) {
            console.error(`Error processing watcher event for ${filePath}:`, error);
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

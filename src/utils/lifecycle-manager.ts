import { Disposable } from '../types';

export class LifecycleManager {
    private disposables: Disposable[] = [];

    /**
     * Track a resource for later disposal.
     */
    public track<T extends Disposable>(resource: T): T {
        this.disposables.push(resource);
        return resource;
    }

    /**
     * Dispose of all tracked resources in reverse order of registration.
     */
    public async disposeAll(): Promise<void> {
        console.error(`[Lifecycle] Disposing ${this.disposables.length} resources...`);
        // Reverse order is important (e.g., stop watcher before closing DB)
        const toDispose = [...this.disposables].reverse();
        this.disposables = [];

        for (const resource of toDispose) {
            try {
                await resource.dispose();
            } catch (err) {
                console.error(`[Lifecycle] Error during disposal: ${err}`);
            }
        }
        console.error(`[Lifecycle] All resources disposed.`);
    }

    /**
     * Helper to wrap an object's method as a Disposable.
     */
    public static wrap(fn: () => Promise<void> | void): Disposable {
        return { dispose: fn };
    }
}

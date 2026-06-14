/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Disposable } from '../types';
import { Logger } from './logger';


const log = new Logger('Lifecycle');
// A-10: cap how long a single resource's dispose() may run before we move on.
const DISPOSE_TIMEOUT_MS = 5000;

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
        log.error(`[Lifecycle] Disposing ${this.disposables.length} resources...`);
        // Reverse order is important (e.g., stop watcher before closing DB)
        const toDispose = [...this.disposables].reverse();
        this.disposables = [];

        for (const resource of toDispose) {
            try {
                await Promise.race([
                    Promise.resolve(resource.dispose()),
                    new Promise<void>((_, reject) => {
                        const timer = setTimeout(() => reject(new Error(`dispose() timed out after ${DISPOSE_TIMEOUT_MS}ms`)), DISPOSE_TIMEOUT_MS);
                        timer.unref?.();
                    }),
                ]);
            } catch (err) {
                log.error(`[Lifecycle] Error during disposal: ${err}`);
            }
        }
        log.error(`[Lifecycle] All resources disposed.`);
    }

    /**
     * Helper to wrap an object's method as a Disposable.
     */
    public static wrap(fn: () => Promise<void> | void): Disposable {
        return { dispose: fn };
    }
}

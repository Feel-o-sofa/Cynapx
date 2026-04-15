/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import { Disposable } from '../types';

/** How long (ms) a single task may run before it is forcibly cancelled. */
const TASK_TIMEOUT_MS = 30_000;

interface QueueEntry {
    task: any;
    resolve: Function;
    reject: Function;
    /** Guard against double-settle (timeout races message/error). */
    settled: boolean;
}

interface ActiveTask {
    entry: QueueEntry;
    timeoutHandle: ReturnType<typeof setTimeout>;
}

export class WorkerPool implements Disposable {
    private workers: Worker[] = [];
    private freeWorkers: Worker[] = [];
    private queue: QueueEntry[] = [];

    /** Maximum number of tasks that may sit in the pending queue. */
    private _maxQueueSize: number;

    /** Path & execArgv stored so replacement workers can be spawned identically. */
    private workerPath: string;
    private workerExecArgv: string[];

    constructor(private size: number = os.cpus().length, { maxQueueSize = 100 }: { maxQueueSize?: number } = {}) {
        this._maxQueueSize = maxQueueSize;

        const isTsNode = process.execArgv.includes('ts-node/register') || process.argv[1].endsWith('.ts');
        this.workerPath = path.resolve(__dirname, isTsNode ? 'index-worker.ts' : 'index-worker.js');
        // Use ts-node to run the worker if we are in dev environment
        this.workerExecArgv = isTsNode ? (process.execArgv.includes('--loader') ? process.execArgv : ['-r', 'ts-node/register']) : [];

        for (let i = 0; i < this.size; i++) {
            this.spawnWorker();
        }
    }

    /**
     * Expose the maximum queue size to allow callers to chunk task submission.
     */
    public get maxQueueSize(): number {
        return this._maxQueueSize;
    }

    /**
     * Spawn a single worker, wire all event handlers, and register it as free.
     * Called both during initial construction and when replacing a crashed/timed-out worker.
     */
    private spawnWorker(): Worker {
        const worker = new Worker(this.workerPath, { execArgv: this.workerExecArgv });

        worker.on('message', (result) => {
            const active: ActiveTask | null = (worker as any).currentTask ?? null;
            if (!active) return; // should not happen, but guard anyway

            clearTimeout(active.timeoutHandle);
            (worker as any).currentTask = null;

            // Return worker to the free pool before processing the next item
            this.freeWorkers.push(worker);
            this.processNext();

            if (!active.entry.settled) {
                active.entry.settled = true;
                if (result.status === 'success') active.entry.resolve(result.delta);
                else active.entry.reject(new Error(result.error));
            }
        });

        worker.on('error', (err) => {
            console.error('Worker error:', err);
            const active: ActiveTask | null = (worker as any).currentTask ?? null;
            this.replaceWorker(worker, active, err);
        });

        this.workers.push(worker);
        this.freeWorkers.push(worker);
        return worker;
    }

    /**
     * Terminate a failed/timed-out worker, remove it from all registries,
     * reject its in-flight task (if any), and spawn a fresh replacement.
     */
    private replaceWorker(worker: Worker, active: ActiveTask | null, reason: Error): void {
        // Remove from the workers list
        const wIdx = this.workers.indexOf(worker);
        if (wIdx !== -1) this.workers.splice(wIdx, 1);

        // Remove from freeWorkers if it somehow ended up there
        const fIdx = this.freeWorkers.indexOf(worker);
        if (fIdx !== -1) this.freeWorkers.splice(fIdx, 1);

        // Terminate silently — the worker may already be dead
        worker.terminate().catch(() => { /* ignore */ });

        // Reject the task that was running when the failure occurred
        if (active && !active.entry.settled) {
            clearTimeout(active.timeoutHandle);
            active.entry.settled = true;
            active.entry.reject(reason);
        }

        // Spawn a replacement so the pool keeps its target size
        this.spawnWorker();

        // Defer processNext to the next event loop tick to avoid re-entrant
        // synchronous call chains (processNext → replaceWorker → spawnWorker → processNext)
        setImmediate(() => this.processNext());
    }

    public runTask(task: any): Promise<any> {
        // Backpressure: reject immediately when the queue is full
        if (this.queue.length >= this._maxQueueSize) {
            return Promise.reject(new Error(
                `WorkerPool queue is full (maxQueueSize=${this._maxQueueSize}). Task rejected.`
            ));
        }

        return new Promise((resolve, reject) => {
            const entry: QueueEntry = { task, resolve, reject, settled: false };
            this.queue.push(entry);
            this.processNext();
        });
    }

    private processNext(): void {
        if (this.queue.length === 0 || this.freeWorkers.length === 0) return;

        const worker = this.freeWorkers.pop()!;
        const entry = this.queue.shift()!;

        // Arm a 30-second timeout for this task
        const timeoutHandle = setTimeout(() => {
            const timeoutErr = new Error(
                `WorkerPool task timed out after ${TASK_TIMEOUT_MS}ms`
            );
            this.replaceWorker(worker, (worker as any).currentTask ?? null, timeoutErr);
        }, TASK_TIMEOUT_MS);

        const active: ActiveTask = { entry, timeoutHandle };
        (worker as any).currentTask = active;
        worker.postMessage(entry.task);
    }

    public dispose(): void {
        // Cancel any queued tasks that never started
        for (const entry of this.queue) {
            if (!entry.settled) {
                entry.settled = true;
                entry.reject(new Error('WorkerPool disposed'));
            }
        }
        this.queue = [];

        // Terminate all workers (clear in-flight timeouts first)
        for (const worker of this.workers) {
            const active: ActiveTask | null = (worker as any).currentTask ?? null;
            if (active) {
                clearTimeout(active.timeoutHandle);
                if (!active.entry.settled) {
                    active.entry.settled = true;
                    active.entry.reject(new Error('WorkerPool disposed'));
                }
            }
            worker.terminate();
        }
        this.workers = [];
        this.freeWorkers = [];
    }
}

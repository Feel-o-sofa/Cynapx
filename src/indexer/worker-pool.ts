
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';

export class WorkerPool {
    private workers: Worker[] = [];
    private freeWorkers: Worker[] = [];
    private queue: { task: any, resolve: Function, reject: Function }[] = [];

    constructor(private size: number = os.cpus().length) {
        const workerPath = path.resolve(__dirname, 'index-worker.ts');
        // Use ts-node to run the worker if we are in dev environment
        const execArgv = process.execArgv.includes('--loader') ? process.execArgv : ['-r', 'ts-node/register'];

        for (let i = 0; i < this.size; i++) {
            const worker = new Worker(workerPath, { execArgv });
            worker.on('message', (result) => {
                const { resolve, reject } = (worker as any).currentTask;
                (worker as any).currentTask = null;
                this.freeWorkers.push(worker);
                this.processNext();
                if (result.status === 'success') resolve(result.delta);
                else reject(new Error(result.error));
            });
            worker.on('error', (err) => {
                if ((worker as any).currentTask) {
                    (worker as any).currentTask.reject(err);
                }
                console.error('Worker error:', err);
            });
            this.workers.push(worker);
            this.freeWorkers.push(worker);
        }
    }

    public runTask(task: any): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.processNext();
        });
    }

    private processNext() {
        if (this.queue.length === 0 || this.freeWorkers.length === 0) return;

        const worker = this.freeWorkers.pop()!;
        const { task, resolve, reject } = this.queue.shift()!;
        (worker as any).currentTask = { resolve, reject };
        worker.postMessage(task);
    }

    public shutdown() {
        this.workers.forEach(w => w.terminate());
    }
}

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { parentPort } from 'worker_threads';
import { createDefaultParser } from './default-parser';
import { Logger } from '../utils/logger';


const log = new Logger('IndexWorker');
// O-11: surface otherwise-silent crashes so the main thread's 'error'
// listener (WorkerPool.replaceWorker) gets a clear diagnostic before the
// worker is terminated/replaced.
process.on('uncaughtException', (err) => {
    log.error('[index-worker] Uncaught exception:', { detail: err });
    throw err;
});
process.on('unhandledRejection', (reason) => {
    log.error('[index-worker] Unhandled rejection:', { detail: reason });
    throw reason instanceof Error ? reason : new Error(String(reason));
});

const compositeParser = createDefaultParser();

if (parentPort) {
    parentPort.on('message', async (message) => {
        const { filePath, commit, version } = message;
        try {
            const delta = await compositeParser.parse(filePath, commit, version);
            parentPort?.postMessage({ status: 'success', delta, filePath });
        } catch (error: any) {
            log.error(`Worker error parsing ${filePath}:`, { detail: error });
            parentPort?.postMessage({ status: 'error', error: error.message, filePath });
        }
    });
}

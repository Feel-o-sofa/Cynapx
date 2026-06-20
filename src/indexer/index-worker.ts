/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { parentPort } from 'worker_threads';
import { TypeScriptParser } from './typescript-parser';
import { TreeSitterParser } from './tree-sitter-parser';
import { DependencyParser } from './dependency-parser';
import { CompositeParser } from './composite-parser';
import { YamlParser } from './yaml-parser';
import { MarkdownParser } from './markdown-parser';
import { JsonConfigParser } from './json-config-parser';
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

// TypeScriptParser handles TS/JS with full type-checking capabilities
const tsParser = new TypeScriptParser();
// TreeSitterParser handles multi-language via generic Providers (includes fallback TS/JS/PY)
const treeSitterParser = new TreeSitterParser();
// DependencyParser handles package.json/requirements.txt
const depParser = new DependencyParser();

const compositeParser = new CompositeParser([tsParser, treeSitterParser, depParser, new YamlParser(), new MarkdownParser(), new JsonConfigParser()]);

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


import { parentPort, workerData } from 'worker_threads';
import { TypeScriptParser } from './typescript-parser';
import { TreeSitterParser } from './tree-sitter-parser';
import { DependencyParser } from './dependency-parser';
import { CompositeParser } from './composite-parser';

const tsParser = new TypeScriptParser();
const treeSitterParser = new TreeSitterParser();
const depParser = new DependencyParser();
const compositeParser = new CompositeParser([tsParser, treeSitterParser, depParser]);

if (parentPort) {
    parentPort.on('message', async (message) => {
        const { filePath, commit, version } = message;
        try {
            const delta = await compositeParser.parse(filePath, commit, version);
            parentPort?.postMessage({ status: 'success', delta, filePath });
        } catch (error: any) {
            parentPort?.postMessage({ status: 'error', error: error.message, filePath });
        }
    });
}

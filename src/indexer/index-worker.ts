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
            console.error(`Worker error parsing ${filePath}:`, error);
            parentPort?.postMessage({ status: 'error', error: error.message, filePath });
        }
    });
}

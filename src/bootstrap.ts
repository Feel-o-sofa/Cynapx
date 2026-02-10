import { DatabaseManager } from './db/database';
import { NodeRepository } from './db/node-repository';
import { EdgeRepository } from './db/edge-repository';
import { GraphEngine } from './graph/graph-engine';
import { UpdatePipeline } from './indexer/update-pipeline';
import { TypeScriptParser } from './indexer/typescript-parser';
import { TreeSitterParser } from './indexer/tree-sitter-parser';
import { CompositeParser } from './indexer/composite-parser';
import { GitService } from './indexer/git-service';
import { ApiServer } from './server/api-server';
import { FileWatcher } from './watcher/file-watcher';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Bootstrap class initializes and wires all components of the Code Knowledge Tool.
 */
async function bootstrap() {
    console.log('--- Starting Code Knowledge Tool ---');

    try {
        // 1. Initialize Database
        const dbManager = new DatabaseManager('knowledge.db');
        const db = dbManager.getDb();
        console.log('Database initialized successfully.');

        // 2. Setup Repositories
        const nodeRepo = new NodeRepository(db);
        const edgeRepo = new EdgeRepository(db);

        // 3. Initialize Graph Engine
        const graphEngine = new GraphEngine(nodeRepo, edgeRepo);
        console.log('Graph Engine initialized.');

        // 4. Setup Indexing Pipeline
        const tsParser = new TypeScriptParser();
        const treeSitterParser = new TreeSitterParser();
        const compositeParser = new CompositeParser([tsParser, treeSitterParser]);

        const updatePipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, compositeParser);
        console.log('Update Pipeline initialized with Multi-language support.');

        // 5. Setup Git Service (Phase D)
        const gitService = new GitService(path.join(__dirname, '..'));
        console.log('Git Service initialized.');

        // 6. Initial Scan (Phase 5.2)
        console.log('Starting Initial Project Scan with Git history...');
        const srcDir = path.join(__dirname, '../src');
        await initialScan(srcDir, updatePipeline, gitService);
        console.log('Initial Scan Complete.');

        // 7. Start File Watcher (Phase 5.2)
        const watcher = new FileWatcher(updatePipeline);
        watcher.start(srcDir);

        // 8. Start API Server
        const apiServer = new ApiServer(graphEngine);
        const port = parseInt(process.env.PORT || '3000', 10);
        apiServer.listen(port);

        console.log('--- Startup Sequence Complete ---');
        console.log(`Knowledge Tool API listening on port ${port}`);
        console.log('The tool is now ready to handle queries.');

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('Shutting down...');
            dbManager.close();
            process.exit(0);
        });

    } catch (error) {
        console.error('Fatal error during startup:', error);
        process.exit(1);
    }
}

/**
 * Recursively scans a directory and indexes all supported files.
 */
async function initialScan(directory: string, pipeline: UpdatePipeline, gitService: GitService) {
    const files = fs.readdirSync(directory);
    const version = Date.now();

    for (const file of files) {
        const fullPath = path.resolve(directory, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            await initialScan(fullPath, pipeline, gitService);
        } else if (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.py')) {
            const commit = await gitService.getLatestCommit(fullPath);
            await pipeline.processChangeEvent({
                event: 'MODIFY',
                file_path: fullPath,
                commit: commit
            }, version);
        }
    }
}

// Execute the bootstrap sequence
bootstrap();

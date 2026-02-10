import { DatabaseManager } from './db/database';
import { NodeRepository } from './db/node-repository';
import { EdgeRepository } from './db/edge-repository';
import { GraphEngine } from './graph/graph-engine';
import { UpdatePipeline } from './indexer/update-pipeline';
import { TypeScriptParser } from './indexer/typescript-parser';
import { TreeSitterParser } from './indexer/tree-sitter-parser';
import { DependencyParser } from './indexer/dependency-parser';
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
        const depParser = new DependencyParser();
        const compositeParser = new CompositeParser([tsParser, treeSitterParser, depParser]);

        const updatePipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, compositeParser);
        console.log('Update Pipeline initialized with Multi-language support.');

        // 5. Setup Git Service (Phase D)
        const gitService = new GitService(path.join(__dirname, '..'));
        console.log('Git Service initialized.');

        // 6. Initial Scan (Phase 5.2)
        console.log('Starting Initial Project Scan with Git history...');
        const rootDir = path.join(__dirname, '..');
        const srcDir = path.join(rootDir, 'src');
        
        // Scan root for config files (non-recursive)
        await scanDirectory(rootDir, updatePipeline, gitService, false);
        // Scan src recursively
        await scanDirectory(srcDir, updatePipeline, gitService, true);
        
        console.log('Initial Scan Complete.');

        // 7. Start File Watcher (Phase 5.2)
        const watcher = new FileWatcher(updatePipeline);
        watcher.start(srcDir);

        // 8. Start API Server
        const apiServer = new ApiServer(graphEngine);

        // Use PORT=0 to auto-assign a free port if variable is not set or set to 0
        const port = parseInt(process.env.PORT || '0', 10);
        apiServer.start(port);

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
 * Scans a directory and indexes supported files.
 */
async function scanDirectory(directory: string, pipeline: UpdatePipeline, gitService: GitService, recursive: boolean) {
    if (!fs.existsSync(directory)) return;
    
    const files = fs.readdirSync(directory);
    const version = Date.now();

    for (const file of files) {
        const fullPath = path.resolve(directory, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (recursive && file !== 'node_modules' && file !== '.git') {
                await scanDirectory(fullPath, pipeline, gitService, true);
            }
        } else if (
            file.endsWith('.ts') || 
            file.endsWith('.js') || 
            file.endsWith('.py') ||
            file === 'package.json' ||
            file === 'requirements.txt'
        ) {
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

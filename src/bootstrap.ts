import { DatabaseManager } from './db/database';
import { NodeRepository } from './db/node-repository';
import { EdgeRepository } from './db/edge-repository';
import { GraphEngine } from './graph/graph-engine';
import { UpdatePipeline } from './indexer/update-pipeline';
import { TypeScriptParser } from './indexer/typescript-parser';
import { TreeSitterParser } from './indexer/tree-sitter-parser';
import { DependencyParser } from './indexer/dependency-parser';
import { CompositeParser } from './indexer/composite-parser';
import { WorkerPool } from './indexer/worker-pool';
import { GitService } from './indexer/git-service';
import { ApiServer } from './server/api-server';
import { McpServer } from './server/mcp-server';
import { FileWatcher } from './watcher/file-watcher';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * The Bootstrap class initializes and wires all components of the Code Knowledge Tool.
 */
async function bootstrap() {
    const isMcpMode = process.env.MCP_MODE === 'true';
    
    // In MCP mode, ALL logs MUST go to stderr. stdout is for JSON-RPC only.
    if (isMcpMode) {
        console.log = console.error;
        console.info = console.error;
        console.debug = console.error;
        console.warn = console.error;
    }
    
    const log = console.error;

    log('--- Starting Code Knowledge Tool (Parallel Mode) ---');

    try {
        // 1. Initialize Database
        const dbManager = new DatabaseManager('knowledge.db');
        const db = dbManager.getDb();
        log('Database initialized successfully.');

        // 2. Setup Repositories
        const nodeRepo = new NodeRepository(db);
        const edgeRepo = new EdgeRepository(db);

        // 3. Initialize Graph Engine
        const graphEngine = new GraphEngine(nodeRepo, edgeRepo);
        log('Graph Engine initialized.');

        // 4. Setup Indexing Pipeline
        const tsParser = new TypeScriptParser();
        const treeSitterParser = new TreeSitterParser();
        const depParser = new DependencyParser();
        const compositeParser = new CompositeParser([tsParser, treeSitterParser, depParser]);

        const workerPool = new WorkerPool(os.cpus().length);
        const updatePipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, compositeParser, workerPool);
        log(`Update Pipeline initialized with WorkerPool (${os.cpus().length} cores).`);

        // 5. Setup Git Service (Phase D)
        const gitService = new GitService(path.join(__dirname, '..'));
        log('Git Service initialized.');

        // 6. Initial Scan (Phase 5.2)
        log('Starting Initial Project Scan with Git history...');
        const rootDir = path.join(__dirname, '..');
        const srcDir = path.join(rootDir, 'src');
        
        const rootFiles = await getFiles(rootDir, false);
        const srcFiles = await getFiles(srcDir, true);
        const allFiles = [...new Set([...rootFiles, ...srcFiles])];
        
        log(`Found ${allFiles.length} files to index. Processing in batch mode...`);
        const version = Date.now();
        
        const events = await Promise.all(allFiles.map(async (fullPath) => {
            const commit = await gitService.getLatestCommit(fullPath);
            return {
                event: 'MODIFY' as const,
                file_path: fullPath,
                commit: commit
            };
        }));

        await updatePipeline.processBatch(events, version);
        
        log('Initial Scan Complete.');

        // 7. Start File Watcher (Phase 5.2)
        const watcher = new FileWatcher(updatePipeline);
        watcher.start(srcDir);

        // 8. Start API Server or MCP Server
        if (isMcpMode) {
            const mcpServer = new McpServer(graphEngine);
            mcpServer.start();
            log('MCP Server active on stdio.');
        } else {
            const apiServer = new ApiServer(graphEngine);
            const port = parseInt(process.env.PORT || '0', 10);
            apiServer.start(port);
            log(`Knowledge Tool API listening on port ${port}`);
        }

        log('--- Startup Sequence Complete ---');

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            log('Shutting down...');
            workerPool.shutdown();
            dbManager.close();
            process.exit(0);
        });

    } catch (error) {
        console.error('Fatal error during startup:', error);
        process.exit(1);
    }
}

/**
 * Recursively collects supported files from a directory.
 */
async function getFiles(directory: string, recursive: boolean): Promise<string[]> {
    const results: string[] = [];
    if (!fs.existsSync(directory)) return results;
    
    const files = fs.readdirSync(directory);

    for (const file of files) {
        const fullPath = path.resolve(directory, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (recursive && file !== 'node_modules' && file !== '.git') {
                const subFiles = await getFiles(fullPath, true);
                results.push(...subFiles);
            }
        } else if (
            file.endsWith('.ts') || 
            file.endsWith('.js') || 
            file.endsWith('.py') ||
            file === 'package.json' ||
            file === 'requirements.txt'
        ) {
            results.push(fullPath);
        }
    }
    return results;
}

// Execute the bootstrap sequence
bootstrap();

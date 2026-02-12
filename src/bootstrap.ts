
import { DatabaseManager } from './db/database';
import { NodeRepository } from './db/node-repository';
import { EdgeRepository } from './db/edge-repository';
import { MetadataRepository } from './db/metadata-repository';
import { GraphEngine } from './graph/graph-engine';
import { UpdatePipeline } from './indexer/update-pipeline';
import { TypeScriptParser } from './indexer/typescript-parser';
import { TreeSitterParser } from './indexer/tree-sitter-parser';
import { DependencyParser } from './indexer/dependency-parser';
import { CompositeParser } from './indexer/composite-parser';
import { WorkerPool } from './indexer/worker-pool';
import { GitService } from './indexer/git-service';
import { ConsistencyChecker } from './indexer/consistency-checker';
import { ApiServer } from './server/api-server';
import { McpServer } from './server/mcp-server';
import { FileWatcher } from './watcher/file-watcher';
import { LifecycleManager } from './utils/lifecycle-manager';
import { getDatabasePath, findProjectAnchor } from './utils/paths';
import { FileFilter } from './utils/file-filter';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * The Bootstrap class initializes and wires all components of Cynapx.
 */
async function bootstrap() {
    const isMcpMode = process.env.MCP_MODE === 'true';
    
    if (isMcpMode) {
        console.log = console.error;
        console.info = console.error;
        console.debug = console.error;
        console.warn = console.error;
    }
    
    const log = isMcpMode ? console.error : console.log;

    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        log(`
Cynapx: High-Performance Isolated Code Knowledge Engine

Usage:
  cynapx [options]

Options:
  --path <dir>    Path to the project directory to analyze (default: current directory)
  --help, -h      Show this help message

Environment Variables:
  MCP_MODE=true   Start in MCP (Model Context Protocol) mode via stdio
  PORT=<number>   Port for the HTTP API server (default: 3000)
        `);
        process.exit(0);
    }

    const pathIndex = args.indexOf('--path');
    const startPath = pathIndex !== -1 && args[pathIndex + 1] 
        ? path.resolve(args[pathIndex + 1]) 
        : process.cwd();

    const anchorPath = findProjectAnchor(startPath);
    const initialProjectPath = anchorPath || startPath;

    log(`--- Starting Cynapx (Parallel Mode) ---`);
    log(`Start Directory: ${startPath}`);
    if (anchorPath) log(`Detected Anchor at: ${anchorPath}`);

    const lifecycle = new LifecycleManager();

    try {
        // Shared components
        let dbManager: DatabaseManager | undefined;
        let nodeRepo: NodeRepository | undefined;
        let edgeRepo: EdgeRepository | undefined;
        let metadataRepo: MetadataRepository | undefined;
        let graphEngine: GraphEngine | undefined;
        let updatePipeline: UpdatePipeline | undefined;
        let consistencyChecker: ConsistencyChecker | undefined;
        let workerPool: WorkerPool | undefined;
        let watcher: FileWatcher | undefined;

        // Initialize core engine functionality
        const initializeEngine = async (projectPath: string) => {
            log(`Initializing Engine for: ${projectPath}`);
            const dbPath = getDatabasePath(projectPath);
            dbManager = lifecycle.track(new DatabaseManager(dbPath));
            const db = dbManager.getDb();
            nodeRepo = new NodeRepository(db);
            edgeRepo = new EdgeRepository(db);
            metadataRepo = new MetadataRepository(db);
            graphEngine = new GraphEngine(nodeRepo, edgeRepo);

            const gitService = new GitService(projectPath);
            const tsParser = new TypeScriptParser();
            const treeSitterParser = new TreeSitterParser();
            const depParser = new DependencyParser();
            const compositeParser = new CompositeParser([tsParser, treeSitterParser, depParser]);

            const workerPoolSize = Math.min(os.cpus().length, 4);
            workerPool = lifecycle.track(new WorkerPool(workerPoolSize));
            updatePipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, compositeParser, metadataRepo, gitService, workerPool);
            consistencyChecker = new ConsistencyChecker(nodeRepo, gitService, updatePipeline, projectPath);

            log('Synchronizing index with Project state...');
            await consistencyChecker.validate(true);
            log('Synchronization Complete.');

            watcher = lifecycle.track(new FileWatcher(updatePipeline, projectPath));
            watcher.start(projectPath);
            
            return { graphEngine, consistencyChecker, metadataRepo };
        };

        let currentGraphEngine: GraphEngine | undefined;
        let currentConsistencyChecker: ConsistencyChecker | undefined;

        if (anchorPath) {
            const result = await initializeEngine(anchorPath);
            currentGraphEngine = result.graphEngine;
            currentConsistencyChecker = result.consistencyChecker;
        } else {
            // Placeholder graph engine if not initialized
            const dbPath = getDatabasePath(startPath); // Temporary or default
            const tempDbManager = new DatabaseManager(dbPath);
            const tempDb = tempDbManager.getDb();
            nodeRepo = new NodeRepository(tempDb);
            edgeRepo = new EdgeRepository(tempDb);
            metadataRepo = new MetadataRepository(tempDb);
            currentGraphEngine = new GraphEngine(nodeRepo, edgeRepo);
        }

        // Start MCP Server
        let mcpServer: McpServer | undefined;
        if (isMcpMode) {
            mcpServer = new McpServer(currentGraphEngine!, metadataRepo!, currentConsistencyChecker);
            
            // Handle deferred initialization
            mcpServer.setOnInitialize(async (newPath) => {
                // Clear old resources before switching
                await lifecycle.disposeAll();
                const result = await initializeEngine(newPath);
                // Dynamically update MCP server's references
                (mcpServer as any).graphEngine = result.graphEngine;
                (mcpServer as any).metadataRepo = result.metadataRepo;
                mcpServer!.setConsistencyChecker(result.consistencyChecker);
            });

            // Handle index purging
            mcpServer.setOnPurge(async () => {
                log('Purging engine resources...');
                await lifecycle.disposeAll();
                
                // Reset local references (they will be re-initialized if needed)
                dbManager = undefined;
                updatePipeline = undefined;
                consistencyChecker = undefined;
            });

            await mcpServer.start();
            log('MCP Server handshake active on stdio.');
            
            if (anchorPath) {
                mcpServer.markReady(true);
            } else {
                log('!!! NO .cynapx-config FOUND !!!');
                log('Server is in PENDING mode. Please initialize via MCP tool.');
                mcpServer.markReady(false);
            }
        } else if (anchorPath) {
            // CLI/API Mode
            const apiServer = new ApiServer(currentGraphEngine!);
            const port = parseInt(process.env.PORT || '3000', 10);
            apiServer.start(port);
            log(`Cynapx API listening on port ${port}`);
        } else {
            log('Error: .cynapx-config not found and not in MCP mode. Cannot start analysis.');
            process.exit(1);
        }

        log('--- Startup Sequence Complete ---');

        if (isMcpMode) {
            process.stdin.on('end', () => {
                log('STDIN closed, triggering graceful shutdown...');
                process.emit('SIGINT');
            });
        }

        process.on('SIGINT', async () => {
            log('Shutting down...');
            if (mcpServer) await mcpServer.close();
            await lifecycle.disposeAll();
            process.exit(0);
        });

    } catch (error) {
        console.error('Fatal error during startup:', error);
        process.exit(1);
    }
}

bootstrap();

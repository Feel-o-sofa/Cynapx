#!/usr/bin/env node
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
import { getDatabasePath } from './utils/paths';
import { FileFilter } from './utils/file-filter';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * The Bootstrap class initializes and wires all components of Cynapx.
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
    
    const log = isMcpMode ? console.error : console.log;

    // 0. Parse Arguments & Resolve Project Path
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        log(`
Cynapx: High-Performance Isolated Code Knowledge Engine

Usage:
  npx ts-node src/bootstrap.ts [options]

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
    const projectPath = pathIndex !== -1 && args[pathIndex + 1] 
        ? path.resolve(args[pathIndex + 1]) 
        : process.cwd();

    if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
        console.error(`Error: Invalid project path: ${projectPath}`);
        process.exit(1);
    }

    log(`--- Starting Cynapx (Parallel Mode) ---`);
    log(`Target Project: ${projectPath}`);

    try {
        // 1. Initialize Database (Centralized & Isolated)
        const dbPath = getDatabasePath(projectPath);
        const dbManager = new DatabaseManager(dbPath);
        const db = dbManager.getDb();
        log(`Database initialized at: ${dbPath}`);

        // 2. Setup Repositories
        const nodeRepo = new NodeRepository(db);
        const edgeRepo = new EdgeRepository(db);
        const metadataRepo = new MetadataRepository(db);

        // 3. Initialize Graph Engine
        const graphEngine = new GraphEngine(nodeRepo, edgeRepo);
        log('Graph Engine initialized.');

        // 8. Start MCP Server early if in MCP mode (to prevent discovery timeout)
        let mcpServer: McpServer | undefined;
        if (isMcpMode) {
            mcpServer = new McpServer(graphEngine);
            mcpServer.start();
            log('MCP Server handshake active on stdio.');
        }

        // 4. Setup Git Service
        const gitService = new GitService(projectPath);
        log('Git Service initialized.');

        // 5. Setup Indexing Pipeline
        const tsParser = new TypeScriptParser();
        const treeSitterParser = new TreeSitterParser();
        const depParser = new DependencyParser();
        const compositeParser = new CompositeParser([tsParser, treeSitterParser, depParser]);

        const workerPool = new WorkerPool(os.cpus().length);
        const updatePipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, compositeParser, metadataRepo, gitService, workerPool);
        log(`Update Pipeline initialized with WorkerPool (${os.cpus().length} cores).`);

        // 6. Sync / Initial Scan (Phase 5.1 - Task 13-1)
        const lastCommit = metadataRepo.getLastIndexedCommit();
        const currentHead = await gitService.getCurrentHead();
        const version = Date.now();

        if (!lastCommit) {
            log('No previous index found. Starting Full Initial Scan...');
            const fileFilter = new FileFilter(projectPath);
            const allFiles = await getFiles(projectPath, true, fileFilter);
            
            log(`Found ${allFiles.length} files to index.`);
            const events = await Promise.all(allFiles.map(async (fullPath) => {
                const commit = await gitService.getLatestCommit(fullPath);
                return {
                    event: 'ADD' as const,
                    file_path: fullPath,
                    commit: commit
                };
            }));
            await updatePipeline.processBatch(events, version);
            metadataRepo.setLastIndexedCommit(currentHead);
            log('Full Initial Scan Complete.');
        } else {
            await updatePipeline.syncWithGit(projectPath);
        }

        // 7. Start File Watcher (Phase 5.2)
        const watcher = new FileWatcher(updatePipeline, projectPath);
        watcher.start(projectPath);

        // 7.5 Setup Consistency Checker
        const consistencyChecker = new ConsistencyChecker(nodeRepo, gitService, updatePipeline, projectPath);
        if (mcpServer) {
            mcpServer.setConsistencyChecker(consistencyChecker);
        }

        // 8. Start API Server (if not in MCP mode)
        if (!isMcpMode) {
            const apiServer = new ApiServer(graphEngine);
            const port = parseInt(process.env.PORT || '3000', 10);
            apiServer.start(port);
            log(`Cynapx API listening on port ${port}`);
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
async function getFiles(directory: string, recursive: boolean, filter?: FileFilter): Promise<string[]> {
    const results: string[] = [];
    if (!fs.existsSync(directory)) return results;
    
    const files = fs.readdirSync(directory);

    for (const file of files) {
        const fullPath = path.resolve(directory, file);
        
        if (filter && filter.isIgnored(fullPath)) {
            continue;
        }

        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (recursive) {
                const subFiles = await getFiles(fullPath, true, filter);
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

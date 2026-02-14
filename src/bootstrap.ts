#!/usr/bin/env node
/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

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
import { SecurityProvider } from './utils/security';
import { CertificateGenerator } from './utils/certificate-generator';
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
  --https         Enable ephemeral HTTPS for the API server
  --help, -h      Show this help message

Environment Variables:
  MCP_MODE=true   Start in MCP (Model Context Protocol) mode via stdio
  PORT=<number>   Port for the HTTP API server (default: 3000)
  SSL_KEY_PATH    (Optional) Path to manual SSL key
  SSL_CERT_PATH   (Optional) Path to manual SSL certificate
        `);
        process.exit(0);
    }

    const pathIndex = args.indexOf('--path');
    const startPath = pathIndex !== -1 && args[pathIndex + 1] 
        ? path.resolve(args[pathIndex + 1]) 
        : process.cwd();

    const useHttps = args.includes('--https');

    const anchorPath = findProjectAnchor(startPath);
    const initialProjectPath = anchorPath || startPath;

    // Load version from package.json
    let version = 'unknown';
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        version = pkg.version;
    } catch (e) {
        // Fallback for production/dist where package.json might be in a different relative path
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
            version = pkg.version;
        } catch (e2) {}
    }

    log(`--- Starting Cynapx v${version} (Parallel Mode) ---`);
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
            updatePipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, compositeParser, metadataRepo, gitService, workerPool, projectPath);
            consistencyChecker = new ConsistencyChecker(nodeRepo, gitService, updatePipeline, projectPath);

            log('Synchronizing index with Project state...');
            await consistencyChecker.validate(true);
            log('Synchronization Complete.');

            watcher = lifecycle.track(new FileWatcher(updatePipeline, projectPath));
            watcher.start(projectPath);
            
            const securityProvider = new SecurityProvider(projectPath);
            
            return { graphEngine, consistencyChecker, metadataRepo, securityProvider };
        };

        let currentGraphEngine: GraphEngine | undefined;
        let currentConsistencyChecker: ConsistencyChecker | undefined;
        let currentSecurityProvider: SecurityProvider | undefined;

        if (anchorPath) {
            const result = await initializeEngine(anchorPath);
            currentGraphEngine = result.graphEngine;
            currentConsistencyChecker = result.consistencyChecker;
            currentSecurityProvider = result.securityProvider;
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

        // Initialize MCP Server (always needed for either Stdio or SSE mode)
        const mcpServer = new McpServer(currentGraphEngine!, metadataRepo!, currentConsistencyChecker);
        if (updatePipeline) {
            mcpServer.setUpdatePipeline(updatePipeline);
        }
        // Important: Register default handlers for Stdio/Single-mode
        mcpServer.registerHandlers();
        
        if (currentSecurityProvider) {
            mcpServer.setSecurityProvider(currentSecurityProvider);
        }

        // Start MCP Server (Stdio Mode)
        if (isMcpMode) {
            // Handle deferred initialization
            mcpServer.setOnInitialize(async (newPath) => {
                // Clear old resources before switching
                await lifecycle.disposeAll();
                const result = await initializeEngine(newPath);
                // Dynamically update MCP server's references
                (mcpServer as any).graphEngine = result.graphEngine;
                (mcpServer as any).metadataRepo = result.metadataRepo;
                mcpServer.setUpdatePipeline(updatePipeline);
                mcpServer!.setConsistencyChecker(result.consistencyChecker);
                mcpServer!.setSecurityProvider(result.securityProvider);
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
            let httpsOptions;
            
            if (useHttps) {
                try {
                    log('Generating ephemeral SSL certificates for purely volatile mode...');
                    httpsOptions = CertificateGenerator.generate();
                    log('Ephemeral SSL certificates generated and loaded into memory.');
                } catch (err) {
                    log(`Error generating ephemeral certificates: ${err}. Falling back to HTTP.`);
                }
            } else if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
                try {
                    httpsOptions = {
                        key: fs.readFileSync(process.env.SSL_KEY_PATH),
                        cert: fs.readFileSync(process.env.SSL_CERT_PATH)
                    };
                    log('Manual SSL Certificates loaded successfully.');
                } catch (err) {
                    log(`Warning: Failed to load SSL certificates from ${process.env.SSL_KEY_PATH} or ${process.env.SSL_CERT_PATH}. Falling back to HTTP.`);
                }
            }

            const apiServer = new ApiServer(currentGraphEngine!, httpsOptions);
            // Attach MCP Server for SSE support
            apiServer.setMcpServer(mcpServer);
            mcpServer.markReady(true); // Standalone server is ready if anchor exists

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

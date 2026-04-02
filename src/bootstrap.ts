/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information. 
 */
import { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { McpServer } from './server/mcp-server';
import { IpcCoordinator } from './server/ipc-coordinator';
import { LockManager } from './utils/lock-manager';
import { findProjectAnchor, addToRegistry, getDatabasePath } from './utils/paths';
import { InteractiveShell } from './server/interactive-shell';
import { WorkspaceManager, EngineContext } from './server/workspace-manager';
import { LanguageRegistry } from './indexer/language-registry';
import { TreeSitterParser } from './indexer/tree-sitter-parser';
import { TypeScriptParser } from './indexer/typescript-parser';
import { CompositeParser } from './indexer/composite-parser';
import { GitService } from './indexer/git-service';
import { UpdatePipeline } from './indexer/update-pipeline';
import { FileWatcher } from './watcher/file-watcher';
import { ApiServer } from './server/api-server';
import { LifecycleManager } from './utils/lifecycle-manager';
import { SecurityProvider } from './utils/security';
import { WorkerPool } from './indexer/worker-pool';
import { CertificateGenerator } from './utils/certificate-generator';

async function bootstrap() {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    const program = new Command();
    program
        .name('cynapx')
        .description('High-performance isolated code knowledge engine for AI agents')
        .version(pkg.version)
        .option('-p, --path <paths...>', 'Project paths to analyze', [process.cwd()])
        .option('--api-port <number>', 'Port for the REST API server', '3000')
        .option('--no-index', 'Disable initial indexing')
        .option('--no-watch', 'Disable file watching')
        .option('--interactive', 'Start in interactive REPL mode', false)
        .option('--api', 'Start the REST API server', false)
        .option('--https', 'Enable ephemeral HTTPS for API server', false)
        .option('--force', 'Force full re-index', false)
        .option('--bind <address>', 'Bind address for the REST API server', '127.0.0.1')
        .parse(process.argv);

    const options = program.opts();
    const args = process.argv.slice(2);

    // [Restoration 1] MCP Mode Logging Protection
    const isMcpMode = !options.api && !options.interactive && !args.some(a => !a.startsWith('-'));
    if (isMcpMode) {
        console.log = console.error;
        console.info = console.error;
        console.warn = console.error;
    }

    console.error(`\x1b[36m
   ______                            __  __
  / ____/_  ______  ____ _____  _  _| |/ /
 / /   / / / / __ \/ __ \`/ __ \| |/_/   / 
/ /___/ /_/ / / / / /_/ / /_/ />  < /   |  
\____/\__, /_/ /_/\__,_/ .___/_/|_/_/|_|  
     /____/           /_/
    \x1b[0m`);

    const lifecycle = new LifecycleManager();
    const workspaceManager = lifecycle.track(new WorkspaceManager());
    const projectPaths: string[] = options.path.map((p: string) => path.resolve(p));

    // Mount projects (Registration ONLY, no DB open yet)
    for (const p of projectPaths) {
        const anchor = findProjectAnchor(p);
        if (anchor) {
            console.error(`[*] Mounting Workspace: ${anchor}`);
            await workspaceManager.mountProject(anchor);
            addToRegistry(anchor);
        }
    }

    if (workspaceManager.getAllContexts().length === 0) {
        console.error("[Fatal] No valid projects found. Exiting.");
        process.exit(1);
    }

    const primaryContext = workspaceManager.getActiveContext()!;
    // Use the auto-cleaning LockManager
    const lockManager = new LockManager(primaryContext.projectPath);
    const mcpServer = new McpServer(workspaceManager);
    const ipcCoordinator = new IpcCoordinator(mcpServer);

    // Helper: Starts heavy services only for Host
    const startHostServices = async () => {
        for (const ctx of workspaceManager.getAllContexts()) {
            console.error(`[*] Initializing Host Engine for: ${ctx.projectPath}`);
            // This now opens the DB
            await workspaceManager.initializeEngine(ctx.projectHash);
            
            const treeSitterParser = new TreeSitterParser();
            const typescriptParser = new TypeScriptParser();
            const compositeParser = new CompositeParser([typescriptParser, treeSitterParser]);
            const gitService = new GitService(ctx.projectPath);
            const workerPool = lifecycle.track(new WorkerPool(Math.min(os.cpus().length, 4)));
            
            const updatePipeline = new UpdatePipeline(
                ctx.dbManager!.getDb(),
                ctx.graphEngine!.nodeRepo,
                (ctx.graphEngine! as any).edgeRepo,
                compositeParser,
                ctx.metadataRepo!,
                gitService,
                workerPool,
                ctx.projectPath,
                ctx.graphEngine!
            );

            ctx.gitService = gitService;
            ctx.updatePipeline = updatePipeline;
            ctx.securityProvider = new SecurityProvider(ctx.projectPath);

            if (!options.noIndex) {
                const head = await gitService.getCurrentHead();
                const last = ctx.metadataRepo!.getLastIndexedCommit();
                if (head !== last || options.force) {
                    console.error(`[*] Synchronizing index...`);
                    await updatePipeline.syncWithGit(ctx.projectPath);
                }
            }

            if (!options.noWatch) {
                const watcher = lifecycle.track(new FileWatcher(updatePipeline, ctx.projectPath));
                watcher.start(ctx.projectPath);
            }
        }
    };

    // [Restoration 2] Robust Failover with Double-Check
    const attemptFailover = async () => {
        const jitter = 500 + Math.random() * 3000;
        await new Promise(r => setTimeout(r, jitter));
        
        const lock = await lockManager.getValidLock();
        if (!lock) {
            console.error(`[*] Host lost. Attempting promotion...`);
            const ipcPort = await ipcCoordinator.startHost();
            
            // Atomic re-check
            const finalCheck = await lockManager.getValidLock();
            if (finalCheck) {
                await ipcCoordinator.connectToHost(finalCheck.ipcPort);
                return;
            }

            await lockManager.acquire(ipcPort);
            mcpServer.promoteToHost();
            
            // Re-start services for all contexts
            await startHostServices();
            mcpServer.markReady(true);
        } else {
            await ipcCoordinator.connectToHost(lock.ipcPort);
        }
    };

    const acquireAndRun = async () => {
        const lock = await lockManager.getValidLock();
        if (lock && lock.pid !== process.pid) {
            console.error(`[*] Found Host (PID: ${lock.pid}). Starting Terminal mode...`);
            try {
                await ipcCoordinator.connectToHost(lock.ipcPort); 
                mcpServer.setTerminal(ipcCoordinator);
                ipcCoordinator.on('disconnected', () => { 
                    console.error("[!] Connection lost. Retrying failover...");
                    attemptFailover().catch(() => process.exit(1)); 
                });
            } catch (err) {
                console.error(`[!] Stale lock? Retrying...`);
                setTimeout(acquireAndRun, 2000);
                return;
            }
        } else {
            const port = await ipcCoordinator.startHost();
            await lockManager.acquire(port);
            console.error(`[*] Host mode active (Singleton Lock Acquired)`);
            
            await startHostServices();

            const heartbeatTimer = setInterval(() => lockManager.heartbeat(), 30000);
            lifecycle.track({ dispose: () => clearInterval(heartbeatTimer) });
            mcpServer.markReady(true);
        }
    };

    await acquireAndRun();

    // [Restoration 3] Dynamic One-Shot CLI Argument Parsing
    let command: string | undefined;
    const commandArgs: any = {};
    for (let i = 0; i < args.length; i++) {
        if (!args[i].startsWith('-')) {
            if (i > 0 && (args[i-1] === '--path' || args[i-1] === '-p')) continue;
            command = args[i];
        } else if (args[i].startsWith('--')) {
            const key = args[i].substring(2);
            const val = args[i+1];
            if (val && !val.startsWith('-')) {
                commandArgs[key] = isNaN(Number(val)) ? val : Number(val);
                i++;
            } else { commandArgs[key] = true; }
        }
    }

    if (command && !options.interactive && !options.api) {
        console.error(`[*] One-Shot CLI: ${command}`);
        try {
            const result = await mcpServer.executeTool(command, commandArgs);
            if (result.isError) {
                console.error("❌ Failed:");
                console.log(JSON.stringify(result.content, null, 2));
                process.exit(1);
            } else {
                result.content.forEach((c: any) => console.log(c.text || JSON.stringify(c, null, 2)));
                process.exit(0);
            }
        } catch (e) { console.error(`[Error] ${e}`); process.exit(1); }
    }

    // Start Interfaces
    if (options.api) {
        let httpsOptions;
        if (options.https) {
            try { httpsOptions = CertificateGenerator.generate(); } catch(e) { console.error("[!] SSL generation failed."); }
        }
        const apiServer = new ApiServer(httpsOptions);
        apiServer.setMcpServer(mcpServer);
        apiServer.start(parseInt(options.apiPort, 10), options.bind);
    }

    if (options.interactive) {
        const shell = new InteractiveShell(mcpServer);
        await shell.start();
    } else if (!options.api && !command) {
        await mcpServer.start();
        console.error("[*] MCP Server ready on stdio.");
    }

    process.on('SIGINT', async () => {
        console.error("\n[*] Shutting down gracefully...");
        await lifecycle.disposeAll();
        await lockManager.release();
        process.exit(0);
    });
}

bootstrap().catch(err => {
    console.error(`[Fatal] Bootstrap failed: ${err.stack}`);
    process.exit(1);
});

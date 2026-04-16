#!/usr/bin/env node
/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Command } from 'commander';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { McpServer } from './server/mcp-server';
import { IpcCoordinator } from './server/ipc-coordinator';
import { LockManager } from './utils/lock-manager';
import { findProjectAnchor, addToRegistry, getDatabasePath, getCentralStorageDir } from './utils/paths';
import { getAuditLogger } from './utils/audit-logger';
import { InteractiveShell } from './server/interactive-shell';
import { WorkspaceManager, EngineContext } from './server/workspace-manager';
import { LanguageRegistry } from './indexer/language-registry';
import { TreeSitterParser } from './indexer/tree-sitter-parser';
import { TypeScriptParser } from './indexer/typescript-parser';
import { CompositeParser } from './indexer/composite-parser';
import { YamlParser } from './indexer/yaml-parser';
import { MarkdownParser } from './indexer/markdown-parser';
import { JsonConfigParser } from './indexer/json-config-parser';
import { GitService } from './indexer/git-service';
import { UpdatePipeline } from './indexer/update-pipeline';
import { FileWatcher } from './watcher/file-watcher';
import { ApiServer } from './server/api-server';
import { LifecycleManager } from './utils/lifecycle-manager';
import { SecurityProvider } from './utils/security';
import { WorkerPool } from './indexer/worker-pool';
import { CertificateGenerator } from './utils/certificate-generator';

process.on('unhandledRejection', (reason: unknown) => {
    console.error('[Process] Unhandled Promise rejection:', reason);
    // 프로세스를 종료하지 않고 로깅만 — 이미 실행 중인 서버 보호
});

process.on('uncaughtException', (err: Error) => {
    console.error('[Process] Uncaught exception:', err?.message ?? err);
    console.error(err?.stack);
    // 복구 불가 예외 — 정리 후 안전하게 종료
    process.exit(1);
});

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

    const hasInitialProjects = workspaceManager.getAllContexts().length > 0;
    if (!hasInitialProjects) {
        console.error("[*] No project anchor found in working directory — starting in PENDING mode.");
        console.error("[*] Call initialize_project from your AI client to register a project.");
    }

    // Use a stable global lock path when no initial project is available.
    // Once a project is registered the lock identity stays the same for this process.
    const primaryContext = workspaceManager.getActiveContext();
    const lockBasePath = primaryContext?.projectPath ?? getCentralStorageDir();
    const lockManager = new LockManager(lockBasePath);
    const mcpServer = new McpServer(workspaceManager);
    const ipcCoordinator = new IpcCoordinator(mcpServer);

    // Helper: initialise a single project context (DB open, pipeline start, optional sync).
    const startHostServicesForContext = async (ctx: EngineContext) => {
        if (ctx.dbManager) return; // already initialised (e.g. re-entrant call)
        console.error(`[*] Initializing Host Engine for: ${ctx.projectPath}`);
        await workspaceManager.initializeEngine(ctx.projectHash);

        const treeSitterParser = new TreeSitterParser();
        const typescriptParser = new TypeScriptParser();
        const compositeParser = new CompositeParser([typescriptParser, treeSitterParser, new YamlParser(), new MarkdownParser(), new JsonConfigParser()]);
        const gitService = new GitService(ctx.projectPath);
        const workerPool = lifecycle.track(new WorkerPool(Math.min(os.cpus().length, 4)));

        const updatePipeline = new UpdatePipeline(
            ctx.dbManager!.getDb(),
            ctx.graphEngine!.nodeRepo,
            ctx.graphEngine!.edgeRepo,
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
            if (head !== last || options.force || ctx.reindexTriggeredByVersion) {
                console.error(`[*] Synchronizing index...`);
                const audit = getAuditLogger();
                audit.log('index_start', { project: ctx.projectPath });
                try {
                    await updatePipeline.syncWithGit(ctx.projectPath);
                    // Update version, timestamp, and registry stats (Req-1+3)
                    const nodeCount = ctx.graphEngine!.nodeRepo.getAllNodes().length;
                    const edgeCount = (ctx.dbManager!.getDb()
                        .prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
                    await workspaceManager.onIndexComplete(ctx.projectHash, nodeCount, edgeCount);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    audit.log('index_error', { project: ctx.projectPath, error: msg });
                    throw err;
                }
            }
        }

        if (!options.noWatch) {
            const watcher = lifecycle.track(new FileWatcher(updatePipeline, ctx.projectPath));
            watcher.start(ctx.projectPath);
        }
    };

    // Helper: Starts heavy services for ALL currently mounted contexts.
    const startHostServices = async () => {
        for (const ctx of workspaceManager.getAllContexts()) {
            await startHostServicesForContext(ctx);
        }
    };

    // Wire up the onInitialize callback: when initialize_project registers a NEW project,
    // mount it and start its services immediately (no server restart required).
    mcpServer.setOnInitialize(async (newPath: string) => {
        const ctx = await workspaceManager.mountProject(newPath);
        await startHostServicesForContext(ctx);
    });

    // [Restoration 2] Robust Failover with Double-Check
    const attemptFailover = async () => {
        const jitter = 500 + Math.random() * 3000;
        await new Promise(r => setTimeout(r, jitter));

        const lock = await lockManager.getValidLock();
        if (!lock) {
            console.error(`[*] Host lost. Attempting promotion...`);
            const sessionNonce = crypto.randomBytes(32).toString('hex');
            const ipcPort = await ipcCoordinator.startHost(sessionNonce);

            // Atomic re-check
            const finalCheck = await lockManager.getValidLock();
            if (finalCheck) {
                await ipcCoordinator.connectToHost(finalCheck.ipcPort, finalCheck.nonce);
                return;
            }

            await lockManager.acquire(ipcPort, sessionNonce);
            mcpServer.promoteToHost();

            // Re-start services for all contexts
            await startHostServices();
            mcpServer.markReady(true);
        } else {
            await ipcCoordinator.connectToHost(lock.ipcPort, lock.nonce);
        }
    };

    const acquireAndRun = async () => {
        const lock = await lockManager.getValidLock();
        if (lock && lock.pid !== process.pid) {
            console.error(`[*] Found Host (PID: ${lock.pid}). Starting Terminal mode...`);
            try {
                await ipcCoordinator.connectToHost(lock.ipcPort, lock.nonce);
                mcpServer.setTerminal(ipcCoordinator);
                ipcCoordinator.on('disconnected', () => {
                    console.error("[!] Connection lost. Retrying failover...");
                    attemptFailover().catch(() => process.exit(1));
                });
            } catch (err) {
                console.error(`[!] Stale lock? Retrying...`);
                const retryTimer = setTimeout(acquireAndRun, 2000);
                lifecycle.track({ dispose: () => clearTimeout(retryTimer) });
                return;
            }
        } else {
            const sessionNonce = crypto.randomBytes(32).toString('hex');
            const port = await ipcCoordinator.startHost(sessionNonce);
            await lockManager.acquire(port, sessionNonce);
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

    const shutdown = async () => {
        console.error("\n[*] Shutting down gracefully...");
        await lifecycle.disposeAll();
        await lockManager.release();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

bootstrap().catch(err => {
    console.error(`[Fatal] Bootstrap failed: ${err.stack}`);
    process.exit(1);
});

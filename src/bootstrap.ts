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
import { McpServer } from './server/mcp-server';
import { IpcCoordinator } from './server/ipc-coordinator';
import { LockManager, LockHeldError, CONNECT_MAX_RETRIES, decideConnectFailureAction } from './utils/lock-manager';
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
import { resolveHttpsOptions } from './utils/https-options';
import { getVersion } from './utils/version';
import { Logger, LogLevel } from './utils/logger';

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
    const program = new Command();
    program
        .name('cynapx')
        .description('High-performance isolated code knowledge engine for AI agents')
        .version(getVersion())
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

    // Phase 13-8 commit D: the structured Logger writes JSON to stderr (never
    // stdout — stdout is reserved for the MCP stdio protocol). Honour CYNAPX_LOG_LEVEL
    // (debug|info|warn|error|silent) so operators can tune verbosity.
    const lvl = (process.env.CYNAPX_LOG_LEVEL || '').toLowerCase();
    const levelMap: Record<string, LogLevel> = {
        debug: LogLevel.DEBUG, info: LogLevel.INFO, warn: LogLevel.WARN,
        error: LogLevel.ERROR, silent: LogLevel.SILENT
    };
    if (lvl in levelMap) Logger.setGlobalLevel(levelMap[lvl]);

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
    // H-5: ensure the embedding sidecar's child process is terminated on shutdown.
    lifecycle.track({ dispose: () => mcpServer.getEmbeddingProvider().dispose?.() });

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
        // H-6: hold the worker pool on the context so unmountProject(hash) can
        // terminate it (in dispose order) when the project is purged.
        ctx.workerPool = workerPool;

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
            // A-6: pass the project profile so the watcher's FileFilter honours
            // excludePatterns / maxFileSize in addition to .gitignore.
            const watcher = lifecycle.track(new FileWatcher(updatePipeline, ctx.projectPath, ctx.profile));
            watcher.start(ctx.projectPath);
            // H-6: hold the watcher on the context so unmountProject(hash) can
            // stop it before the DB is closed (otherwise a post-purge flush
            // would write to a closed handle).
            ctx.watcher = watcher;
        }
    };

    // Helper: Starts heavy services for ALL currently mounted contexts.
    const startHostServices = async () => {
        for (const ctx of workspaceManager.getAllContexts()) {
            await startHostServicesForContext(ctx);
        }
    };

    // A-11: per-project lock identity. The primary `lockManager` keys on the
    // initial project path (or, in PENDING mode, the global central-storage
    // dir). When initialize_project later registers a DIFFERENT project, the
    // primary lock does NOT cover that project — a separate process started
    // inside that project directory would hold *its* project lock and both
    // would believe they are Host, double-indexing the same DB. We therefore
    // acquire a project-specific lock per newly initialized project. If another
    // live Host already owns it, we must not start host services for that
    // project (avoid the double-indexing / watermark race); we log and skip,
    // deferring ownership to the existing Host.
    const projectLocks = new Map<string, LockManager>();
    const primaryLockBase = path.resolve(lockBasePath);
    // This Host's live IPC identity, captured whenever this process becomes (or
    // is promoted to) Host. Project locks acquired on behalf of newly
    // initialized projects reuse it so Terminals reading those locks reach us.
    let hostIpcPort = 0;
    let hostNonce = '';
    mcpServer.setOnInitialize(async (newPath: string) => {
        const ctx = await workspaceManager.mountProject(newPath);

        // If this project is already covered by the primary lock (same path),
        // no extra lock is needed — start services directly.
        if (path.resolve(newPath) === primaryLockBase) {
            await startHostServicesForContext(ctx);
            return;
        }

        const projectLock = new LockManager(newPath);
        try {
            // Reuse this Host's IPC port/nonce as the project lock's identity so
            // Terminals that read the project lock can still reach this Host.
            await projectLock.acquire(hostIpcPort, hostNonce || crypto.randomBytes(32).toString('hex'));
            projectLocks.set(ctx.projectHash, projectLock);
            lifecycle.track({ dispose: () => projectLock.release() });
            await startHostServicesForContext(ctx);
        } catch (err) {
            if (err instanceof LockHeldError) {
                // Another live Host already owns this project — do NOT open the
                // DB / start a pipeline here (that would be the A-11 split-brain).
                console.error(
                    `[!] Project ${newPath} is already hosted by PID ${err.lock.pid} ` +
                    `(ipcPort=${err.lock.ipcPort}). Skipping host services to avoid double-indexing.`
                );
                return;
            }
            throw err;
        }
    });

    // H-6: purge_index tears down the live engine for a project. Wire it to
    // WorkspaceManager.unmountProject(hash) so the watcher / worker pool /
    // dbManager are disposed in order and every engine field is nulled — this
    // prevents the zombie-context bug where a post-purge watcher flush writes to
    // a closed DB handle, and lets a subsequent initialize_project rebuild the
    // engine (the disposed-but-non-null dbManager no longer short-circuits the
    // re-init guard). Previously setOnPurge was never called, so onPurge was
    // always a no-op.
    mcpServer.setOnPurge(async (hash: string) => {
        await workspaceManager.unmountProject(hash);
        // If this project held its own A-11 lock, release it — the index it
        // guarded no longer exists.
        const projectLock = projectLocks.get(hash);
        if (projectLock) {
            await projectLock.release();
            projectLocks.delete(hash);
        }
    });

    // H-1: a single heartbeat timer, started by whichever path becomes Host
    // (acquireAndRun's fresh acquire OR attemptFailover's promotion). Tracked
    // so it is cleared on shutdown and never duplicated.
    let heartbeatTimer: NodeJS.Timeout | null = null;
    const startHeartbeatTimer = () => {
        if (heartbeatTimer) return;
        heartbeatTimer = setInterval(() => {
            lockManager.heartbeat().catch(err =>
                console.error(`[!] Heartbeat write failed: ${err instanceof Error ? err.message : err}`));
            // A-11: project locks acquired for initialize_project'd projects must
            // also heartbeat, or they would look stale and be reclaimed.
            for (const pl of projectLocks.values()) {
                pl.heartbeat().catch(err =>
                    console.error(`[!] Project heartbeat write failed: ${err instanceof Error ? err.message : err}`));
            }
        }, 30000);
        lifecycle.track({ dispose: () => { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } } });
    };

    // H-1: cap the Terminal connect retry loop. A dead Host whose PID was reused
    // by an unrelated process keeps getValidLock() returning a "live" lock
    // forever; without a cap, acquireAndRun retries connect every 2s endlessly
    // and the MCP server never becomes ready. After CONNECT_MAX_RETRIES failed
    // connects, if the lock's heartbeat is also stale we forcibly reclaim it and
    // re-run acquisition (escalation), instead of looping indefinitely.
    let connectRetries = 0;

    // [Restoration 2] Robust Failover with Double-Check
    const attemptFailover = async () => {
        const jitter = 500 + Math.random() * 3000;
        await new Promise(r => setTimeout(r, jitter));

        const lock = await lockManager.getValidLock();
        if (!lock) {
            console.error(`[*] Host lost. Attempting promotion...`);
            const sessionNonce = crypto.randomBytes(32).toString('hex');
            const ipcPort = await ipcCoordinator.startHost(sessionNonce);

            try {
                await lockManager.acquire(ipcPort, sessionNonce);
            } catch (err) {
                if (err instanceof LockHeldError) {
                    // Another process won the promotion race — connect to it instead.
                    ipcCoordinator.close();
                    await ipcCoordinator.connectToHost(err.lock.ipcPort, err.lock.nonce);
                    return;
                }
                throw err;
            }

            // A-11: record the promoted Host's IPC identity for project locks.
            hostIpcPort = ipcPort;
            hostNonce = sessionNonce;

            // H-1: readyPromise is already resolved from this session's prior
            // Terminal-mode markReady(true), so executeTool would pass
            // waitUntilReady() immediately. Reset it BEFORE promoting so any
            // tool calls that arrive while engine contexts are being rebuilt
            // block until startHostServices() completes, instead of hitting
            // an EngineNotReadyError (or worse, an undefined `ctx.xxx!`).
            mcpServer.markReady(false);
            mcpServer.promoteToHost();

            try {
                // Re-start services for all contexts
                await startHostServices();
                // H-1: a promoted Host MUST emit heartbeats too. Previously only
                // acquireAndRun's fresh-acquire path started the timer, so a
                // failover-promoted Host wrote no heartbeats — once heartbeat age
                // is used for staleness validation, that omission would make the
                // promoted Host look stale and invite split-brain.
                startHeartbeatTimer();
            } finally {
                mcpServer.markReady(true);
            }
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
                connectRetries = 0;
                mcpServer.setTerminal(ipcCoordinator);
                ipcCoordinator.on('disconnected', () => {
                    console.error("[!] Connection lost. Retrying failover...");
                    attemptFailover().catch(() => process.exit(1));
                });
            } catch (err) {
                connectRetries++;
                // H-1: PID-reuse defence. A dead Host whose PID was reused keeps
                // getValidLock() returning a "live" lock forever; retrying
                // connect to its dead port endlessly means the MCP server never
                // becomes ready. Decide whether to reclaim (heartbeat stale, or
                // retry cap reached) or back off and retry.
                const action = decideConnectFailureAction(
                    lockManager.isHeartbeatStale(lock),
                    connectRetries,
                );
                if (action === 'reclaim') {
                    console.error(`[!] Host PID ${lock.pid} unreachable (retries=${connectRetries}, heartbeatStale=${lockManager.isHeartbeatStale(lock)}) — reclaiming stale lock.`);
                    lockManager.forceReclaim(lock.nonce);
                    connectRetries = 0;
                    const retryTimer = setTimeout(acquireAndRun, 200);
                    lifecycle.track({ dispose: () => clearTimeout(retryTimer) });
                    return;
                }
                console.error(`[!] Stale lock? Retrying (${connectRetries}/${CONNECT_MAX_RETRIES})...`);
                const retryTimer = setTimeout(acquireAndRun, 2000);
                lifecycle.track({ dispose: () => clearTimeout(retryTimer) });
                return;
            }
        } else {
            const sessionNonce = crypto.randomBytes(32).toString('hex');
            const port = await ipcCoordinator.startHost(sessionNonce);
            try {
                await lockManager.acquire(port, sessionNonce);
            } catch (err) {
                if (err instanceof LockHeldError) {
                    // Lost the race to become Host — fall back to Terminal mode.
                    console.error(`[*] Lost host race to PID ${err.lock.pid}. Retrying as Terminal...`);
                    ipcCoordinator.close();
                    const retryTimer = setTimeout(acquireAndRun, 200);
                    lifecycle.track({ dispose: () => clearTimeout(retryTimer) });
                    return;
                }
                throw err;
            }
            console.error(`[*] Host mode active (Singleton Lock Acquired)`);
            connectRetries = 0;
            // A-11: record this Host's IPC identity for project locks.
            hostIpcPort = port;
            hostNonce = sessionNonce;

            await startHostServices();

            startHeartbeatTimer();
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
        // O-10: a one-shot invocation must run the lifecycle dispose chain before
        // exiting so the DB is WAL-checkpointed and the lock released, instead of
        // bypassing cleanup with a bare process.exit() (which leaves the WAL
        // un-checkpointed and relies on stale-lock recovery).
        let exitCode = 0;
        try {
            const result = await mcpServer.executeTool(command, commandArgs);
            if (result.isError) {
                console.error("❌ Failed:");
                console.log(JSON.stringify(result.content, null, 2));
                exitCode = 1;
            } else {
                result.content.forEach((c: any) => console.log(c.text || JSON.stringify(c, null, 2)));
            }
        } catch (e) {
            console.error(`[Error] ${e}`);
            exitCode = 1;
        }
        try {
            await lifecycle.disposeAll();
            await lockManager.release();
        } catch (e) {
            console.error(`[!] Cleanup after one-shot command failed: ${e instanceof Error ? e.message : e}`);
        }
        process.exit(exitCode);
    }

    // Start Interfaces
    if (options.api) {
        // H-9 (diagnostic-v10): when --https is requested, certificate
        // generation failure is fatal — never fall back silently to plain
        // HTTP (with --bind 0.0.0.0 that would leak tokens on the wire).
        let httpsOptions;
        try {
            const resolved = resolveHttpsOptions(options.https, options.bind);
            httpsOptions = resolved.httpsOptions;
            for (const warning of resolved.warnings) console.error(warning);
        } catch (e) {
            console.error(`[!] ${e instanceof Error ? e.message : e}`);
            process.exit(1);
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

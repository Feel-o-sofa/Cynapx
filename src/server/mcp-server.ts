/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Server as SdkMcpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ErrorCode,
    McpError
} from "@modelcontextprotocol/sdk/types.js";
import { RemediationEngine } from '../graph/remediation-engine';
import { IpcCoordinator } from './ipc-coordinator';
import { EmbeddingProvider } from '../indexer/embedding-manager';
import { createEmbeddingProviderFromEnv } from '../indexer/embedding-providers/index';
import { WorkspaceManager, EngineContext } from './workspace-manager';
import { readRegistry, isPathInside } from '../utils/paths';
import { getVersion } from '../utils/version';
import { registerResourceHandlers } from './resource-provider';
import { registerPromptHandlers } from './prompt-provider';
import { HealthMonitor } from './health-monitor';
import { registerToolHandlers, ToolDeps, executeTool } from './tool-dispatcher';
import { Logger } from '../utils/logger';


const log = new Logger('MCP');

/**
 * Agent-facing operator manual injected into the client's context at connect
 * time (MCP `instructions`). This is the primary way ANY agent — Claude,
 * Codex, a local LLM — learns how to drive Cynapx, so keep it model-agnostic,
 * tool-accurate, and concise. The version is interpolated so it never goes
 * stale; update the body whenever tools or the recommended flow change.
 */
function buildCynapxInstructions(version: string): string {
    return `# Cynapx Operator Manual (v${version})
Cynapx is a persistent code knowledge graph. Query structure and intent directly instead of guessing from raw text. All tools are model-agnostic.

## Recommended flow
1. **Orient** — call \`get_project_overview\` first on an unfamiliar codebase (purpose, stack, architecture, entry points, hotspots).
2. **Locate** — \`search_symbols\` (keyword or semantic) to find symbols; \`find_similar_symbols\` to surface duplicates/patterns. You may pass a pre-computed \`query_embedding\` to keep queries in your own model space.
3. **Understand** — \`get_symbol_details\`, \`get_callers\`, \`get_callees\`, \`get_related_tests\`. Ask "why does this exist" with \`get_symbol_history\`; "what changed lately" with \`get_recent_changes\`.
4. **Investigate before editing** — ALWAYS run \`analyze_impact\` (ripple effect) before changing a symbol.
5. **Guard architecture** — \`get_architecture\` and \`check_architecture_violations\` after structural work; \`get_remediation_strategy\` for fixes.
6. **Write back** — record decisions, gotchas, todos, and rationale with \`add_annotation\` so future sessions inherit your context; read them with \`get_annotations\`.

## Invariants
- **Investigation-first**: never modify code before \`analyze_impact\` + \`get_symbol_details\`.
- **Context efficiency**: \`get_symbol_details\` prunes large symbols; widen with its own params rather than re-reading whole files.
- **Temporal tools need history**: \`get_recent_changes\` / \`get_symbol_history\` require \`backfill_history\` to have been run once.
- **Zero-pollution**: Cynapx never writes to the project; do not add local config unless asked.
- **Consistency**: inspect the \`graph://ledger\` resource; run \`check_consistency\` (with \`repair: true\`) if counts diverge.

## Resources
\`graph://summary\`, \`graph://hotspots\`, \`graph://clusters\`, \`graph://ledger\`.`;
}

export class McpServer {
    private sdkServer: SdkMcpServer;
    public workspaceManager: WorkspaceManager;
    private embeddingProvider: EmbeddingProvider;
    private remediationEngine: RemediationEngine;
    private readyPromise: Promise<void>;
    private resolveReady?: () => void;
    private isInitialized: boolean = false;
    private isTerminal: boolean = false;
    private terminalCoordinator?: IpcCoordinator;

    private onInitializeCallback?: (newPath: string) => Promise<void>;
    private onPurgeCallback?: (hash: string) => Promise<void>;
    private healthMonitor: HealthMonitor = new HealthMonitor();
    private toolDeps!: ToolDeps;

    constructor(workspaceManager?: WorkspaceManager) {
        const version = getVersion();

        this.sdkServer = new SdkMcpServer({
            name: "cynapx",
            version
        }, {
            capabilities: { resources: {}, tools: {}, prompts: {} },
            instructions: buildCynapxInstructions(version)
        });

        this.workspaceManager = workspaceManager || new WorkspaceManager();
        // P9-0: provider is selected from env vars (CYNAPX_EMBED_*). Absent
        // config falls back to the jina-sidecar default — unchanged behavior.
        this.embeddingProvider = createEmbeddingProviderFromEnv();
        this.remediationEngine = new RemediationEngine();

        this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });
        this.registerHandlers();
    }

    private getContext(): EngineContext {
        const ctx = this.workspaceManager.getActiveContext();
        if (!ctx) throw new McpError(ErrorCode.InvalidRequest, "No active project in workspace.");
        return ctx;
    }

    public getEmbeddingProvider(): EmbeddingProvider { return this.embeddingProvider; }

    public get isInTerminalMode(): boolean { return this.isTerminal; }
    public get isReady(): boolean { return this.isInitialized; }

    public setTerminal(coordinator: IpcCoordinator) {
        this.isTerminal = true;
        this.terminalCoordinator = coordinator;
        this.markReady(true);
    }

    public promoteToHost() {
        this.isTerminal = false;
        this.terminalCoordinator = undefined;
        log.error("[McpServer] Promoted to Host mode.");
    }

    public markReady(ready: boolean) {
        if (ready && this.resolveReady) {
            this.resolveReady();
            this.isInitialized = true;
            this.startHealthMonitor();
        } else if (!ready) {
            this.isInitialized = false;
            // Reset promise so waitUntilReady() blocks again after purge
            this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });
        }
    }

    private startHealthMonitor() {
        if (this.isTerminal) return;
        this.healthMonitor.start(this.workspaceManager);
    }

    private async waitUntilReady() {
        if (!this.isInitialized) {
            const currentPath = process.cwd();
            const registry = readRegistry();
            const isRegistered = registry.some(p => isPathInside(currentPath, p.path));
            if (!isRegistered) {
                throw new McpError(ErrorCode.InvalidRequest, "Project not initialized. Please use 'initialize_project' first.");
            }
            // H-1: Do NOT set isInitialized = true here. The registry check is
            // only used to produce a helpful error for unregistered projects;
            // actual readiness is signaled exclusively via markReady(true),
            // which resolves readyPromise and starts the health monitor.
            // Setting it here let waitUntilReady() report "ready" while the
            // engine context (graphEngine, dbManager, etc.) was still being
            // constructed, exposing a window for `ctx.xxx!` to be undefined.
        }
        await this.readyPromise;
    }

    public setOnInitialize(callback: (newPath: string) => Promise<void>) {
        this.onInitializeCallback = callback;
    }

    public setOnPurge(callback: (hash: string) => Promise<void>) {
        this.onPurgeCallback = callback;
    }

    public async start() {
        const transport = new StdioServerTransport();
        await this.sdkServer.connect(transport);
    }

    public async close() {
        this.healthMonitor.stop();
        await this.sdkServer.close();
    }

    public async connectTransport(transport: any) {
        await this.sdkServer.connect(transport);
    }

    /**
     * H-1: Create a fresh SdkMcpServer instance with all handlers registered for a new HTTP session.
     * The MCP SDK allows connect() only once per server instance, so each StreamableHTTP session
     * needs its own SdkMcpServer. This method constructs one and wires up all tool/resource/prompt
     * handlers so each session behaves identically to the singleton stdio server.
     */
    public createSdkServerForSession(): SdkMcpServer {
        const version = getVersion();

        const sessionServer = new SdkMcpServer({
            name: "cynapx",
            version
        }, {
            capabilities: { resources: {}, tools: {}, prompts: {} },
            instructions: buildCynapxInstructions(version)
        });

        // Re-register all handlers on the per-session server using shared deps
        registerResourceHandlers(sessionServer, this.waitUntilReady.bind(this), this.getContext.bind(this));
        registerToolHandlers(sessionServer, this.toolDeps);
        registerPromptHandlers(sessionServer, this.waitUntilReady.bind(this));

        return sessionServer;
    }

    /**
     * Unified handler registration split into logical units
     */
    public registerHandlers() {
        registerResourceHandlers(this.sdkServer, this.waitUntilReady.bind(this), this.getContext.bind(this));
        this.toolDeps = this.buildToolDeps();
        registerToolHandlers(this.sdkServer, this.toolDeps);
        registerPromptHandlers(this.sdkServer, this.waitUntilReady.bind(this));
    }

    public async executeTool(name: string, args: any): Promise<any> {
        return executeTool(name, args, this.toolDeps);
    }

    private buildToolDeps(): ToolDeps {
        return {
            waitUntilReady: this.waitUntilReady.bind(this),
            getContext: this.getContext.bind(this),
            isTerminal: () => this.isTerminal,
            getTerminalCoordinator: () => this.terminalCoordinator,
            embeddingProvider: this.embeddingProvider,
            workspaceManager: this.workspaceManager,
            remediationEngine: this.remediationEngine,
            // Use lazy thunks so callbacks set after construction are picked up
            onInitialize: (p: string) => this.onInitializeCallback ? this.onInitializeCallback(p) : Promise.resolve(),
            onPurge: (hash: string) => this.onPurgeCallback ? this.onPurgeCallback(hash) : Promise.resolve(),
            markReady: this.markReady.bind(this),
            getIsInitialized: () => this.isInitialized,
            setIsInitialized: (value: boolean) => {
                if (!value) {
                    this.markReady(false);
                } else {
                    this.isInitialized = value;
                }
            },
        };
    }
}

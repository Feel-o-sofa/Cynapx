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
import * as path from 'path';
import * as fs from 'fs';
import { RemediationEngine } from '../graph/remediation-engine';
import { IpcCoordinator } from './ipc-coordinator';
import { EmbeddingProvider, PythonEmbeddingProvider } from '../indexer/embedding-manager';
import { WorkspaceManager, EngineContext } from './workspace-manager';
import { readRegistry } from '../utils/paths';
import { registerResourceHandlers } from './resource-provider';
import { registerPromptHandlers } from './prompt-provider';
import { HealthMonitor } from './health-monitor';
import { registerToolHandlers, ToolDeps, executeTool } from './tool-dispatcher';

const CYNAPX_INSTRUCTIONS = `
# Cynapx Operator Manual (v1.0.6)
You are operating the Cynapx high-performance code knowledge engine. Adhere to these protocol invariants:
1. **Investigation-First**: Before modifying code, always use 'analyze_impact' and 'get_symbol_details'.
2. **Context Efficiency**: For symbols with >100 lines, 'get_symbol_details' automatically prunes the output. Use 'read_file' with specific offsets for full logic.
3. **Architectural Integrity**: Use 'check_architecture_violations' after major refactors.
4. **Data Purity**: Follow the Zero-Pollution principle. No local configs unless asked.
5. **Consistency**: Monitor 'graph://ledger'. Use 'check_consistency --repair' if sums do not match.
`;

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
    private onPurgeCallback?: () => Promise<void>;
    private healthMonitor: HealthMonitor = new HealthMonitor();
    private toolDeps!: ToolDeps;

    constructor(workspaceManager?: WorkspaceManager) {
        let version = "1.0.5";
        try {
            const pkgPath = path.join(__dirname, '..', '..', 'package.json');
            if (fs.existsSync(pkgPath)) version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
        } catch (e) {}

        this.sdkServer = new SdkMcpServer({
            name: "cynapx",
            version
        }, {
            capabilities: { resources: {}, tools: {}, prompts: {} },
            instructions: CYNAPX_INSTRUCTIONS
        });

        this.workspaceManager = workspaceManager || new WorkspaceManager();
        this.embeddingProvider = new PythonEmbeddingProvider();
        this.remediationEngine = new RemediationEngine();

        this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });
        this.registerHandlers();
    }

    private getContext(): EngineContext {
        const ctx = this.workspaceManager.getActiveContext();
        if (!ctx) throw new McpError(ErrorCode.InvalidRequest, "No active project in workspace.");
        return ctx;
    }

    public setTerminal(coordinator: IpcCoordinator) {
        this.isTerminal = true;
        this.terminalCoordinator = coordinator;
        this.markReady(true);
    }

    public promoteToHost() {
        this.isTerminal = false;
        this.terminalCoordinator = undefined;
        console.error("[McpServer] Promoted to Host mode.");
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
            const isRegistered = registry.some(p => currentPath.toLowerCase().startsWith(p.path.toLowerCase()));
            if (!isRegistered) {
                throw new McpError(ErrorCode.InvalidRequest, "Project not initialized. Please use 'initialize_project' first.");
            }
            this.isInitialized = true;
        }
        await this.readyPromise;
    }

    public setOnInitialize(callback: (newPath: string) => Promise<void>) {
        this.onInitializeCallback = callback;
    }

    public setOnPurge(callback: () => Promise<void>) {
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
        let version = "1.0.5";
        try {
            const pkgPath = path.join(__dirname, '..', '..', 'package.json');
            if (fs.existsSync(pkgPath)) version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
        } catch (e) {}

        const sessionServer = new SdkMcpServer({
            name: "cynapx",
            version
        }, {
            capabilities: { resources: {}, tools: {}, prompts: {} },
            instructions: CYNAPX_INSTRUCTIONS
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
            onPurge: () => this.onPurgeCallback ? this.onPurgeCallback() : Promise.resolve(),
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

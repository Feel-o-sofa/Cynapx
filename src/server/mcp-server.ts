/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Server as SdkMcpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ListPromptsRequestSchema,
    GetPromptRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as path from 'path';
import * as fs from 'fs';
import { RemediationEngine } from '../graph/remediation-engine';
import { IpcCoordinator } from './ipc-coordinator';
import { EmbeddingProvider, PythonEmbeddingProvider } from '../indexer/embedding-manager';
import { WorkspaceManager, EngineContext } from './workspace-manager';
import { ConsistencyChecker } from '../indexer/consistency-checker';
import { addToRegistry, getDatabasePath, readRegistry, ANCHOR_FILE } from '../utils/paths';
import { CynapxErrorCode } from '../types';
import { SecurityProvider } from '../utils/security';

/**
 * [Phase 14] Zod Schemas for Strict Protocol Reinforcement
 */
const CodeNodeSchema = z.object({
    qualified_name: z.string(),
    symbol_type: z.string(),
    language: z.string().optional(),
    file_path: z.string().optional(),
    tags: z.string().array().optional(),
    metrics: z.object({
        loc: z.number().optional(),
        cyclomatic: z.number().optional(),
        fan_in: z.number().optional(),
        fan_out: z.number().optional()
    }).optional()
});

const CodeEdgeSchema = z.object({
    from_id: z.number(),
    to_id: z.number(),
    edge_type: z.string(),
    dynamic: z.boolean()
});

const ArchitectureViolationSchema = z.object({
    policyId: z.string(),
    description: z.string(),
    source: CodeNodeSchema,
    target: CodeNodeSchema,
    edge: CodeEdgeSchema
});

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
    
    private isCheckingConsistency: boolean = false;
    private onInitializeCallback?: (newPath: string) => Promise<void>;
    private onPurgeCallback?: () => Promise<void>;

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
            instructions: `
# Cynapx Operator Manual (Phase 14)
You are operating the Cynapx high-performance code knowledge engine. Adhere to these protocol invariants:
1. **Investigation-First**: Before modifying code, always use 'analyze_impact' and 'get_symbol_details'.
2. **Context Efficiency**: For symbols with >100 lines, 'get_symbol_details' automatically prunes the output. Use 'read_file' with specific offsets for full logic.
3. **Architectural Integrity**: Use 'check_architecture_violations' after major refactors.
4. **Data Purity**: Follow the Zero-Pollution principle. No local configs unless asked.
5. **Consistency**: Monitor 'graph://ledger'. Use 'check_consistency --repair' if sums do not match.
`
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
        }
    }

    private startHealthMonitor() {
        if (this.isTerminal) return;
        setInterval(async () => {
            if (this.isCheckingConsistency) return;
            try {
                const ctx = this.workspaceManager.getActiveContext();
                if (!ctx) return;
                
                const stats = ctx.metadataRepo!.getLedgerStats();
                const isConsistent = 
                    stats.metadata.total_calls_count === stats.actual.sum_fan_in &&
                    stats.metadata.total_calls_count === stats.actual.sum_fan_out;

                if (!isConsistent) {
                    console.error("[HealthMonitor] Ledger inconsistency detected. Triggering auto-repair...");
                    this.isCheckingConsistency = true;
                    const checker = new ConsistencyChecker(ctx.graphEngine!.nodeRepo, (ctx as any).gitService, (ctx as any).updatePipeline, ctx.projectPath);
                    await checker.validate(true, false);
                    this.isCheckingConsistency = false;
                }
            } catch (err) {}
        }, 5 * 60 * 1000);
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
        await this.sdkServer.close();
    }

    public async connectTransport(transport: any) {
        await this.sdkServer.connect(transport);
    }

    /**
     * Unified handler registration split into logical units
     */
    public registerHandlers() {
        this.registerResources();
        this.registerTools();
        this.registerPrompts();
    }

    private registerResources() {
        this.sdkServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
            resources: [
                { uri: "graph://ledger", name: "Knowledge Graph Ledger", mimeType: "application/json", description: "Global call ledger and consistency metrics" },
                { uri: "graph://summary", name: "Graph Summary", mimeType: "application/json", description: "Summary of nodes, edges and files" },
                { uri: "graph://hotspots", name: "Graph Hotspots", mimeType: "application/json", description: "Technical debt hotspots (Complexity & Coupling)" },
                { uri: "graph://clusters", name: "Logical Clusters", mimeType: "application/json", description: "Semantic groupings into logical modules" }
            ]
        }));

        this.sdkServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            await this.waitUntilReady();
            const ctx = this.getContext();
            const db = ctx.dbManager!.getDb();
            const uri = request.params.uri;

            if (uri === "graph://ledger") {
                return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(ctx.metadataRepo!.getLedgerStats(), null, 2) }] };
            }
            if (uri === "graph://summary") {
                const nodeCount = (db.prepare("SELECT COUNT(*) as count FROM nodes").get() as any).count;
                const edgeCount = (db.prepare("SELECT COUNT(*) as count FROM edges").get() as any).count;
                const fileCount = (db.prepare("SELECT COUNT(DISTINCT file_path) as count FROM nodes").get() as any).count;
                return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ nodes: nodeCount, edges: edgeCount, files: fileCount, project: ctx.projectPath, last_updated: new Date().toISOString() }, null, 2) }] };
            }
            if (uri === "graph://hotspots") {
                const topComplexity = db.prepare("SELECT qualified_name, symbol_type, cyclomatic FROM nodes ORDER BY cyclomatic DESC LIMIT 10").all();
                const topFanIn = db.prepare("SELECT qualified_name, symbol_type, fan_in FROM nodes ORDER BY fan_in DESC LIMIT 10").all();
                return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ by_complexity: topComplexity, by_fan_in: topFanIn, last_updated: new Date().toISOString() }, null, 2) }] };
            }
            if (uri === "graph://clusters") {
                const clusters = db.prepare("SELECT * FROM logical_clusters").all();
                const result = clusters.map((c: any) => {
                    const count = (db.prepare("SELECT COUNT(*) as count FROM nodes WHERE cluster_id = ?").get(c.id) as any).count;
                    return { ...c, node_count: count };
                });
                return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result, null, 2) }] };
            }
            throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
        });
    }

    private registerTools() {
        this.sdkServer.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "get_setup_context",
                    description: "Get project initialization status and registry info.",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "initialize_project",
                    description: "Initialize and register a project in the central registry.",
                    inputSchema: {
                        type: "object", 
                        properties: {
                            mode: { type: "string", enum: ["current", "existing", "custom"] },
                            path: { type: "string" },
                            zero_pollution: { type: "boolean", default: true }
                        },
                        required: ["mode"]
                    }
                },
                {
                    name: "search_symbols",
                    description: "Search for symbols with semantic support.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string" }, 
                            semantic: { type: "boolean" }, 
                            limit: { type: "number" },
                            symbol_type: { type: "string" }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "get_symbol_details",
                    description: "Get comprehensive details, metrics, and pruned source code for a symbol.",
                    inputSchema: {
                        type: "object", 
                        properties: {
                            qualified_name: { type: "string" },
                            include_source: { type: "boolean", default: true },
                            summary_only: { type: "boolean", default: false }
                        }, 
                        required: ["qualified_name"]
                    }
                },
                {
                    name: "analyze_impact",
                    description: "Identify all symbols that depend on this symbol (ripple effect).",
                    inputSchema: {
                        type: "object", 
                        properties: {
                            qualified_name: { type: "string" }, 
                            max_depth: { type: "number", default: 3 },
                            use_cache: { type: "boolean", default: true }
                        },
                        required: ["qualified_name"]
                    }
                },
                {
                    name: "get_callers",
                    description: "Get direct callers of a symbol.",
                    inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
                },
                {
                    name: "get_callees",
                    description: "Get symbols called by a symbol.",
                    inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
                },
                {
                    name: "get_related_tests",
                    description: "Find associated test symbols for a production symbol.",
                    inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
                },
                {
                    name: "check_architecture_violations",
                    description: "Detect layer or role violations in the codebase.",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "get_remediation_strategy",
                    description: "Get structural guidance for fixing violations.",
                    inputSchema: { type: "object", properties: { violation: { type: "object" } }, required: ["violation"] }
                },
                {
                    name: "propose_refactor",
                    description: "Get a risk-aware refactoring proposal.",
                    inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
                },
                {
                    name: "get_risk_profile",
                    description: "Calculate risk profile based on CC, churn and coupling.",
                    inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
                },
                {
                    name: "get_hotspots",
                    description: "Identify technical debt hotspots via specific metrics.",
                    inputSchema: {
                        type: "object", 
                        properties: {
                            metric: { type: "string", enum: ["cyclomatic", "fan_in", "fan_out", "loc"] },
                            threshold: { type: "number", default: 0 }
                        },
                        required: ["metric"]
                    }
                },
                {
                    name: "find_dead_code",
                    description: "Identify unreachable or unused symbols.",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "export_graph",
                    description: "Generate Mermaid visualization and structural summary.",
                    inputSchema: {
                        type: "object", 
                        properties: {
                            root_qname: { type: "string" }, 
                            max_depth: { type: "number", default: 2 }
                        }
                    }
                },
                {
                    name: "check_consistency",
                    description: "Verify graph integrity against disk and Git.",
                    inputSchema: {
                        type: "object", 
                        properties: {
                            repair: { type: "boolean", default: false }, 
                            force: { type: "boolean", default: false }
                        }
                    }
                },
                {
                    name: "purge_index",
                    description: "Completely delete local database index.",
                    inputSchema: {
                        type: "object", 
                        properties: {
                            confirm: { type: "boolean" },
                            unregister: { type: "boolean" }
                        },
                        required: ["confirm"]
                    }
                },
                {
                    name: "re_tag_project",
                    description: "Re-run structural characteristic tagging.",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "backfill_history",
                    description: "Fetch and map Git commit history.",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "discover_latent_policies",
                    description: "Discover implicit architectural patterns.",
                    inputSchema: {
                        type: "object", 
                        properties: {
                            threshold: { type: "number", default: 0.9 },
                            min_count: { type: "number", default: 5 }
                        }
                    }
                }
            ]
        }));

        this.sdkServer.setRequestHandler(CallToolRequestSchema, async (request) => {
            return this.executeTool(request.params.name, request.params.arguments);
        });
    }

    private registerPrompts() {
        this.sdkServer.setRequestHandler(ListPromptsRequestSchema, async () => ({
            prompts: [
                {
                    name: "explain-impact", 
                    description: "Explain ripple effect of changing a symbol", 
                    arguments: [{ name: "qualified_name", description: "The qualified name of the symbol", required: true }]
                },
                {
                    name: "check-health", 
                    description: "Check graph health and consistency"
                },
                {
                    name: "refactor-safety", 
                    description: "Perform a comprehensive safety check before refactoring a symbol", 
                    arguments: [{ name: "qualified_name", description: "The qualified name of the symbol", required: true }]
                }
            ]
        }));

        this.sdkServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
            await this.waitUntilReady();
            const name = request.params.name;
            const args = request.params.arguments || {};

            if (name === "explain-impact") {
                return {
                    messages: [{
                        role: "user", 
                        content: {
                            type: "text", 
                            text: `Please analyze the impact of changing the symbol '${args.qualified_name}'. Use the 'analyze_impact' tool to find incoming dependencies and explain what might break.`
                        } 
                    }]
                };
            }
            if (name === "check-health") {
                return {
                    messages: [{
                        role: "user", 
                        content: {
                            type: "text", 
                            text: "Please run a consistency check on the knowledge graph using the 'check_consistency' tool and report any issues found."
                        }
                    }]
                };
            }
            if (name === "refactor-safety") {
                return {
                    messages: [{
                        role: "user", 
                        content: {
                            type: "text", 
                            text: `I am planning to refactor the symbol '${args.qualified_name}'. 
Please follow this safety protocol:\n1. Read 'graph://ledger' to verify the current index integrity.\n2. Use 'analyze_impact' with 'qualified_name: ${args.qualified_name}' to identify all incoming dependencies.\n3. Use 'get_symbol_details' to check the complexity and metrics of '${args.qualified_name}'.\n4. Provide a risk assessment summary: (Low/Medium/High risk) based on the number of dependencies and complexity.`
                        }
                    }]
                };
            }
            throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
        });
    }

    public async executeTool(name: string, args: any): Promise<any> {
        if (this.isTerminal && this.terminalCoordinator) return this.terminalCoordinator.forwardExecuteTool(name, args);
        await this.waitUntilReady();

        switch (name) {
            case 'get_setup_context': {
                const registry = readRegistry();
                return { content: [{ type: "text", text: JSON.stringify({ status: this.isInitialized ? "ALREADY_INITIALIZED" : "INITIALIZATION_REQUIRED", current_path: process.cwd(), registered_projects: registry }, null, 2) }] };
            }
            case 'initialize_project': {
                let target = args.path ? path.resolve(args.path) : process.cwd();
                if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
                if (!args.zero_pollution) fs.writeFileSync(path.join(target, ANCHOR_FILE), JSON.stringify({ created_at: new Date().toISOString() }));
                addToRegistry(target);
                if (this.onInitializeCallback) await this.onInitializeCallback(target);
                this.markReady(true);
                return { content: [{ type: "text", text: `Successfully initialized project at ${target}. Analysis engine is now active.` }] };
            }
            case 'search_symbols': {
                const limit = args.limit || 10;
                const results = await Promise.all(this.workspaceManager.getAllContexts().map(async (ctx) => {
                    const keywordNodes = ctx.graphEngine!.nodeRepo.searchSymbols(args.query, limit, { symbol_type: args.symbol_type });
                    if (!args.semantic) return keywordNodes;
                    try {
                        const queryVector = await this.embeddingProvider.generate(args.query);
                        const vectorResults = ctx.vectorRepo!.search(queryVector, limit);
                        const vectorNodes = vectorResults.map(r => ctx.graphEngine!.getNodeById(r.id)).filter(n => n !== null);
                        return this.mergeResultsRRF(keywordNodes, vectorNodes, limit);
                    } catch { return keywordNodes; }
                }));
                const flat = results.flat().slice(0, limit);
                return { content: [{ type: "text", text: JSON.stringify(flat.map(n => ({ qname: n.qualified_name, type: n.symbol_type, file: n.file_path, tags: n.tags })), null, 2) }] };
            }
            case 'get_symbol_details': {
                const ctx = this.getContext();
                const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
                if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
                
                if (args.summary_only) return { content: [{ type: "text", text: JSON.stringify({ qname: node.qualified_name, type: node.symbol_type, metrics: { loc: node.loc, cyclomatic: node.cyclomatic, fan_in: node.fan_in, fan_out: node.fan_out } }, null, 2) }] };

                let text = `### Symbol: ${node.qualified_name}\n`;
                text += `- **Type**: ${node.symbol_type}\n`;
                if (node.signature) text += `- **Signature**: ${node.signature}\n`;
                text += `- **File**: ${node.file_path} (line ${node.start_line}-${node.end_line})\n`;
                
                if (node.tags && node.tags.length > 0) {
                    text += `- **Structural Tags**: ${Array.isArray(node.tags) ? node.tags.map(t => `${t}`).join(', ') : node.tags}\n`;
                }

                if (node.history && node.history.length > 0) {
                    text += `\n#### Historical Evidence:\n`;
                    node.history.slice(0, 3).forEach(commit => {
                        text += `- **[${commit.hash.substring(0, 7)}]** ${commit.message} (by ${commit.author})\n`;
                    });
                }

                text += `\n#### Metrics:\n- LOC: ${node.loc}, CC: ${node.cyclomatic}\n- Static Coupling: Fan-in: ${node.fan_in || 0}, Fan-out: ${node.fan_out || 0}\n`;

                if (args.include_source !== false) {
                    try {
                        const security = (ctx as any).securityProvider as SecurityProvider;
                        if (security) security.validatePath(node.file_path);
                        const content = fs.readFileSync(node.file_path, 'utf8').split('\n');
                        const snippet = content.slice(node.start_line - 1, node.end_line);
                        const display = snippet.length > 100 ? 
                            snippet.slice(0, 50).join('\n') + "\n\n// ... [Truncated for Token Optimization: Use read_file for full content] ..." : 
                            snippet.join('\n');
                        text += '\n#### Source Code Snippet:\n```\n' + display + '\n```\n';
                    } catch (e) { text += `\n> [!WARNING] Source unavailable: ${e}`; }
                }
                return { content: [{ type: "text", text }] };
            }
            case 'analyze_impact': {
                const ctx = this.getContext();
                const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
                if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
                const results = ctx.graphEngine!.traverse(node.id!, 'BFS', { direction: 'incoming', maxDepth: args.max_depth || 3, useCache: args.use_cache });
                const formatted = results.map(r => ({
                    node: r.node.qualified_name,
                    distance: r.distance,
                    impact_path: r.path.map(step => ctx.graphEngine!.getNodeById(step.nodeId)?.qualified_name).reverse().join(' -> ')
                }));
                return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
            }
            case 'get_callers': {
                const ctx = this.getContext();
                const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
                if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
                const callers = ctx.graphEngine!.getIncomingEdges(node.id!).map(e => ({ qname: ctx.graphEngine!.getNodeById(e.from_id)?.qualified_name, line: e.call_site_line }));
                return { content: [{ type: "text", text: JSON.stringify(callers, null, 2) }] };
            }
            case 'get_callees': {
                const ctx = this.getContext();
                const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
                if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
                const callees = ctx.graphEngine!.getOutgoingEdges(node.id!).map(e => ({ qname: ctx.graphEngine!.getNodeById(e.to_id)?.qualified_name, line: e.call_site_line }));
                return { content: [{ type: "text", text: JSON.stringify(callees, null, 2) }] };
            }
            case 'get_related_tests': {
                const ctx = this.getContext();
                const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
                if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
                const tests = ctx.graphEngine!.getIncomingEdges(node.id!).filter(e => e.edge_type === 'tests').map(e => ctx.graphEngine!.getNodeById(e.from_id)?.qualified_name);
                return { content: [{ type: "text", text: JSON.stringify(tests, null, 2) }] };
            }
            case 'check_architecture_violations': {
                const violations = await this.getContext().archEngine!.checkViolations();
                return { content: [{ type: "text", text: JSON.stringify(violations, null, 2) }] };
            }
            case 'get_remediation_strategy': {
                if (!args.violation) {
                    return { isError: true, content: [{ type: "text", text: "Missing required argument: violation" }] };
                }
                if (!args.violation.source || !args.violation.target) {
                    return { isError: true, content: [{ type: "text", text: "Invalid violation object: 'source' and 'target' nodes are required. Pass a violation object returned by check_architecture_violations." }] };
                }
                const strategy = this.remediationEngine.getRemediationStrategy(args.violation);
                return { content: [{ type: "text", text: JSON.stringify(strategy, null, 2) }] };
            }
            case 'propose_refactor': {
                const proposal = await this.getContext().refactorEngine!.proposeRefactor(args.qualified_name);
                return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
            }
            case 'get_risk_profile': {
                const profile = await this.getContext().refactorEngine!.getRiskProfile(args.qualified_name);
                return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
            }
            case 'get_hotspots': {
                const ctx = this.getContext();
                const db = ctx.dbManager!.getDb();
                const hotspots = db.prepare(`SELECT qualified_name, symbol_type, ${args.metric} FROM nodes WHERE ${args.metric} >= ? ORDER BY ${args.metric} DESC LIMIT 20`).all(args.threshold || 0);
                return { content: [{ type: "text", text: JSON.stringify(hotspots, null, 2) }] };
            }
            case 'find_dead_code': {
                const report = await this.getContext().optEngine!.findDeadCode();
                const totalDead = report.summary.deadSymbols;
                let text = `Found ${totalDead} potential dead code symbols:\n`;
                text += `- HIGH confidence (private, fan_in=0): ${report.summary.highConfidenceDead} symbols\n`;
                text += `- MEDIUM confidence (public, trait:internal, fan_in=0): ${report.summary.mediumConfidenceDead} symbols\n`;
                text += `- LOW confidence (public, fan_in=0, may be external API): ${report.summary.lowConfidenceDead} symbols\n`;
                text += `\nTotal symbols analyzed: ${report.summary.totalSymbols} | Optimization potential: ${report.summary.optimizationPotential}\n`;

                if (report.high.length > 0) {
                    text += `\nHIGH confidence (review first):\n`;
                    report.high.forEach(node => {
                        text += `  - ${node.qualified_name} [${node.symbol_type}] (${node.file_path}:${node.start_line})\n`;
                    });
                }

                if (report.medium.length > 0) {
                    text += `\nMEDIUM confidence:\n`;
                    report.medium.forEach(node => {
                        text += `  - ${node.qualified_name} [${node.symbol_type}] (${node.file_path}:${node.start_line})\n`;
                    });
                }

                // LOW confidence: 개수만 표시, 목록 생략 (FP 비율 높음)
                if (report.low.length > 0) {
                    text += `\nLOW confidence: ${report.low.length} symbols (list omitted — high false-positive rate, likely external API surface)\n`;
                }

                return { content: [{ type: "text", text }] };
            }
            case 'export_graph': {
                const ctx = this.getContext();
                const mermaid = await ctx.graphEngine!.exportToMermaid({ rootQName: args.root_qname, maxDepth: args.max_depth || 2 });
                const data = await ctx.graphEngine!.getGraphData({ rootQName: args.root_qname, maxDepth: args.max_depth || 2 });
                const summary = `### Graph Export: ${args.root_qname || 'Root'}\n- Nodes: ${data.nodes.length}\n- Edges: ${data.edges.length}\n\n${mermaid}\n`;
                return { content: [{ type: "text", text: summary }] };
            }
            case 'check_consistency': {
                const ctx = this.getContext();
                const checker = new ConsistencyChecker(ctx.graphEngine!.nodeRepo, (ctx as any).gitService, (ctx as any).updatePipeline, ctx.projectPath);
                const results = await checker.validate(args.repair, args.force);
                return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
            }
            case 'purge_index': {
                if (!args.confirm) return { content: [{ type: "text", text: "WARNING: This deletes all index data. Confirm with 'confirm: true'" }] };
                const ctx = this.getContext();
                const dbPath = getDatabasePath(ctx.projectPath);
                if (this.onPurgeCallback) await this.onPurgeCallback();
                ctx.dbManager?.dispose();
                this.isInitialized = false;
                [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
                if (args.unregister) require('../utils/paths').removeFromRegistry(ctx.projectPath);
                return { content: [{ type: "text", text: "Project index purged successfully. Server in PENDING mode." }] };
            }
            case 're_tag_project': {
                const pipeline = (this.getContext() as any).updatePipeline;
                await pipeline.reTagAllNodes();
                return { content: [{ type: "text", text: "Successfully re-tagged all nodes." }] };
            }
            case 'backfill_history': {
                const pipeline = (this.getContext() as any).updatePipeline;
                await pipeline.mapHistoryToProject();
                return { content: [{ type: "text", text: "Successfully backfilled Git history." }] };
            }
            case 'discover_latent_policies': {
                const policies = await this.getContext().policyDiscoverer!.discoverPolicies(args.threshold, args.min_count);
                return { content: [{ type: "text", text: JSON.stringify(policies, null, 2) }] };
            }
            default: throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
    }

    private mergeResultsRRF(keywordNodes: any[], vectorNodes: any[], limit: number): any[] {
        const k = 60;
        const scores = new Map<number, number>();
        const nodeMap = new Map<number, any>();
        const applyRRF = (nodes: any[]) => {
            nodes.forEach((node, rank) => {
                const id = node.id!;
                nodeMap.set(id, node);
                scores.set(id, (scores.get(id) || 0) + (1 / (k + rank + 1)));
            });
        };
        applyRRF(keywordNodes);
        applyRRF(vectorNodes);
        return Array.from(scores.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => nodeMap.get(id));
    }
}

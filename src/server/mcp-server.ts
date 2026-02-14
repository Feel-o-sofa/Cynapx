/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { GraphEngine } from '../graph/graph-engine';
import { ConsistencyChecker } from '../indexer/consistency-checker';
import { MetadataRepository } from '../db/metadata-repository';
import { CynapxErrorCode } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { ANCHOR_FILE, readRegistry, addToRegistry, getDatabasePath } from '../utils/paths';
import { SecurityProvider } from '../utils/security';

export class McpServer {
    private sdkServer: SdkMcpServer;
    private isCheckingConsistency: boolean = false;
    private readyPromise: Promise<void>;
    private resolveReady?: () => void;
    private isInitialized: boolean = false;
    private onInitializeCallback?: (newPath: string) => Promise<void>;
    private onPurgeCallback?: () => Promise<void>;
    private securityProvider?: SecurityProvider;

    constructor(
        public graphEngine: GraphEngine,
        public metadataRepo: MetadataRepository,
        public consistencyChecker?: ConsistencyChecker
    ) {
        let version = "1.0.2";
        try {
            const pkgPath = path.join(__dirname, '..', '..', 'package.json');
            if (fs.existsSync(pkgPath)) {
                version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
            } else {
                // Try alternate path for dist
                const distPkgPath = path.join(__dirname, '..', 'package.json');
                if (fs.existsSync(distPkgPath)) {
                    version = JSON.parse(fs.readFileSync(distPkgPath, 'utf8')).version;
                }
            }
        } catch (e) {}

        this.sdkServer = new SdkMcpServer({
            name: "cynapx",
            version: version
        });

        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });
    }

    /**
     * Registers all standard Cynapx handlers (tools, resources, prompts) to the SDK server.
     * This is public to allow registration on fresh server instances for new sessions.
     */
    public registerHandlers() {
        this.registerTools();
        this.registerResources();
        this.registerPrompts();
    }

    public markReady(initialized: boolean = true) {
        this.isInitialized = initialized;
        if (this.resolveReady) {
            this.resolveReady();
            console.error(`Cynapx MCP Server marked as READY (Initialized: ${initialized})`);
        }
        if (initialized) {
            this.startHealthMonitor();
        }
    }

    private startHealthMonitor() {
        // Run health check every 5 minutes
        setInterval(async () => {
            if (this.isCheckingConsistency || !this.consistencyChecker) return;

            const stats = this.metadataRepo.getLedgerStats();
            const isConsistent = 
                stats.metadata.total_calls_count === stats.actual.sum_fan_in &&
                stats.metadata.total_calls_count === stats.actual.sum_fan_out &&
                stats.metadata.total_dynamic_calls_count === stats.actual.sum_fan_in_dynamic &&
                stats.metadata.total_dynamic_calls_count === stats.actual.sum_fan_out_dynamic;

            if (!isConsistent) {
                console.error("HealthMonitor: Ledger inconsistency detected! Triggering auto-repair...");
                this.isCheckingConsistency = true;
                try {
                    await this.consistencyChecker.validate(true, false);
                    console.error("HealthMonitor: Auto-repair completed successfully.");
                } catch (err) {
                    console.error(`HealthMonitor: Auto-repair failed: ${err}`);
                } finally {
                    this.isCheckingConsistency = false;
                }
            }
        }, 5 * 60 * 1000);
    }

    public setOnInitialize(callback: (newPath: string) => Promise<void>) {
        this.onInitializeCallback = callback;
    }

    public setOnPurge(callback: () => Promise<void>) {
        this.onPurgeCallback = callback;
    }

    private async waitUntilReady() {
        // Only wait for the initial startup promise
        if (!this.isInitialized) {
            const currentPath = process.cwd();
            const registry = readRegistry();
            const isRegistered = registry.some(p => currentPath.toLowerCase().startsWith(p.path.toLowerCase()));
            
            if (!isRegistered) {
                throw {
                    error_code: CynapxErrorCode.INITIALIZATION_REQUIRED,
                    message: "Project not initialized. Please use 'initialize_project' first."
                };
            }
            this.isInitialized = true;
        }
    }

    private registerResources() {
        this.sdkServer.registerResource(
            "Graph Summary",
            "graph://summary",
            {
                description: "A summary of the current code knowledge graph"
            },
            async (uri) => {
                try {
                    await this.waitUntilReady();
                } catch (e: any) {
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: "application/json",
                            text: JSON.stringify({ error: e.message, setup_required: true })
                        }]
                    };
                }
                const db = (this.graphEngine.nodeRepo as any).db;
                const nodeCount = db.prepare("SELECT COUNT(*) as count FROM nodes").get().count;
                const edgeCount = db.prepare("SELECT COUNT(*) as count FROM edges").get().count;
                const fileCount = db.prepare("SELECT COUNT(DISTINCT file_path) as count FROM nodes").get().count;

                return {
                    contents: [{
                        uri: uri.href,
                        mimeType: "application/json",
                        text: JSON.stringify({
                            nodes: nodeCount,
                            edges: edgeCount,
                            files: fileCount,
                            last_updated: new Date().toISOString()
                        }, null, 2)
                    }]
                };
            }
        );

        this.sdkServer.registerResource(
            "Graph Ledger",
            "graph://ledger",
            {
                description: "Global call ledger and consistency metrics (Conservation Law)"
            },
            async (uri) => {
                try {
                    await this.waitUntilReady();
                } catch (e: any) {
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: "application/json",
                            text: JSON.stringify({ error: e.message, setup_required: true })
                        }]
                    };
                }

                const stats = this.metadataRepo.getLedgerStats();
                const isConsistent = 
                    stats.metadata.total_calls_count === stats.actual.sum_fan_in &&
                    stats.metadata.total_calls_count === stats.actual.sum_fan_out &&
                    stats.metadata.total_dynamic_calls_count === stats.actual.sum_fan_in_dynamic &&
                    stats.metadata.total_dynamic_calls_count === stats.actual.sum_fan_out_dynamic;

                return {
                    contents: [{
                        uri: uri.href,
                        mimeType: "application/json",
                        text: JSON.stringify({
                            ledger: stats.metadata,
                            actual_sums: stats.actual,
                            is_consistent: isConsistent,
                            conservation_law: "SUM(fan_in) == SUM(fan_out) == total_calls_count",
                            last_updated: new Date().toISOString()
                        }, null, 2)
                    }]
                };
            }
        );

        this.sdkServer.registerResource(
            "Graph Hotspots",
            "graph://hotspots",
            {
                description: "Top technical debt hotspots (High complexity and coupling)"
            },
            async (uri) => {
                try {
                    await this.waitUntilReady();
                } catch (e: any) {
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: "application/json",
                            text: JSON.stringify({ error: e.message, setup_required: true })
                        }]
                    };
                }

                const db = (this.graphEngine.nodeRepo as any).db;
                
                const topComplexity = db.prepare("SELECT qualified_name, symbol_type, cyclomatic FROM nodes ORDER BY cyclomatic DESC LIMIT 10").all();
                const topFanIn = db.prepare("SELECT qualified_name, symbol_type, fan_in FROM nodes ORDER BY fan_in DESC LIMIT 10").all();
                const topFanOut = db.prepare("SELECT qualified_name, symbol_type, fan_out FROM nodes ORDER BY fan_out DESC LIMIT 10").all();

                return {
                    contents: [{
                        uri: uri.href,
                        mimeType: "application/json",
                        text: JSON.stringify({
                            by_complexity: topComplexity,
                            by_fan_in: topFanIn,
                            by_fan_out: topFanOut,
                            last_updated: new Date().toISOString()
                        }, null, 2)
                    }]
                };
            }
        );

        this.sdkServer.registerResource(
            "Logical Clusters",
            "graph://clusters",
            {
                description: "Semantic groupings of symbols into logical modules (Core, Utility, Domain)"
            },
            async (uri) => {
                try {
                    await this.waitUntilReady();
                } catch (e: any) {
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: "application/json",
                            text: JSON.stringify({ error: e.message, setup_required: true })
                        }]
                    };
                }

                const db = (this.graphEngine.nodeRepo as any).db;
                const clusters = db.prepare("SELECT * FROM logical_clusters").all();
                const result = clusters.map((c: any) => {
                    const nodeCount = db.prepare("SELECT COUNT(*) as count FROM nodes WHERE cluster_id = ?").get(c.id).count;
                    return { ...c, node_count: nodeCount };
                });

                return {
                    contents: [{
                        uri: uri.href,
                        mimeType: "application/json",
                        text: JSON.stringify(result, null, 2)
                    }]
                };
            }
        );
    }

    private registerPrompts() {
        this.sdkServer.registerPrompt(
            "explain-impact",
            {
                description: "Explain the impact of changing a specific symbol",
                argsSchema: {
                    qualified_name: z.string().describe("The qualified name of the symbol")
                }
            },
            async ({ qualified_name }) => {
                await this.waitUntilReady();
                return {
                    messages: [{
                        role: "user",
                        content: {
                            type: "text",
                            text: `Please analyze the impact of changing the symbol '${qualified_name}'. Use the 'analyze_impact' tool to find incoming dependencies and explain what might break.`
                        }
                    }]
                };
            }
        );

        this.sdkServer.registerPrompt(
            "check-health",
            {
                description: "Check the health and consistency of the code knowledge graph"
            },
            async () => {
                await this.waitUntilReady();
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
        );

        this.sdkServer.registerPrompt(
            "refactor-safety",
            {
                description: "Perform a comprehensive safety check before refactoring a symbol",
                argsSchema: {
                    qualified_name: z.string().describe("The qualified name of the symbol to be refactored")
                }
            },
            async ({ qualified_name }) => {
                await this.waitUntilReady();
                return {
                    messages: [{
                        role: "user",
                        content: {
                            type: "text",
                            text: `I am planning to refactor the symbol '${qualified_name}'. 
Please follow this safety protocol:
1. Read 'graph://ledger' to verify the current index integrity.
2. Use 'analyze_impact' with 'qualified_name: ${qualified_name}' to identify all incoming dependencies.
3. Use 'get_symbol_details' to check the complexity and metrics of '${qualified_name}'.
4. Provide a risk assessment summary: (Low/Medium/High risk) based on the number of dependencies and complexity.`
                        }
                    }]
                };
            }
        );
    }

    public setConsistencyChecker(checker: ConsistencyChecker) {
        this.consistencyChecker = checker;
    }

    public setSecurityProvider(provider: SecurityProvider) {
        this.securityProvider = provider;
    }

    private registerTools() {
        // get_setup_context
        this.sdkServer.registerTool(
            "get_setup_context",
            {
                description: "Get information needed to initialize a project when .cynapx-config is missing. Returns registry projects and current path.",
                inputSchema: z.object({})
            },
            async () => {
                const registry = readRegistry();
                const currentPath = process.cwd();
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            status: this.isInitialized ? "ALREADY_INITIALIZED" : "INITIALIZATION_REQUIRED",
                            current_directory: currentPath,
                            registered_projects: registry,
                            instructions: "Choose to (1) Load an existing project, (2) Initialize at current directory, or (3) Initialize at custom path."
                        }, null, 2)
                    }]
                };
            }
        );

        // initialize_project
        this.sdkServer.registerTool(
            "initialize_project",
            {
                description: "Initialize a project and register it in the central registry. By default, it operates in Zero-Pollution mode.",
                inputSchema: z.object({
                    mode: z.enum(['current', 'existing', 'custom']).describe("Setup mode"),
                    path: z.string().optional().describe("Absolute path for 'existing' or 'custom' mode"),
                    zero_pollution: z.boolean().optional().default(true).describe("If true (default), do NOT create .cynapx-config file in the project directory.")
                })
            },
            async ({ mode, path: targetPath, zero_pollution }) => {
                let projectPath = process.cwd();
                if (mode === 'existing' || mode === 'custom') {
                    if (!targetPath) return { isError: true, content: [{ type: "text", text: "Path is required for this mode." }] };
                    projectPath = path.resolve(targetPath);
                }

                try {
                    if (!fs.existsSync(projectPath)) {
                        fs.mkdirSync(projectPath, { recursive: true });
                    }

                    if (!zero_pollution) {
                        const anchorPath = path.join(projectPath, ANCHOR_FILE);
                        if (!fs.existsSync(anchorPath)) {
                            fs.writeFileSync(anchorPath, JSON.stringify({ created_at: new Date().toISOString() }, null, 2));
                        }
                    }
                    
                    addToRegistry(projectPath);

                    if (this.onInitializeCallback) {
                        await this.onInitializeCallback(projectPath);
                    }

                    this.markReady(true);

                    return {
                        content: [{ type: "text", text: `Successfully initialized project at ${projectPath}${zero_pollution ? ' (Zero-Pollution Mode)' : ''}. Analysis engine is now active.` }]
                    };
                } catch (err) {
                    return { isError: true, content: [{ type: "text", text: `Initialization failed: ${err}` }] };
                }
            }
        );

        // search_symbols
        this.sdkServer.registerTool(
            "search_symbols",
            {
                description: "Search for symbols (functions, classes, variables) in the code knowledge graph using a search query. Returns basic metadata for matching symbols.",
                inputSchema: z.object({
                    query: z.string().describe("Search query for symbol names (supports partial matches)"),
                    limit: z.number().optional().default(10).describe("Maximum number of results to return"),
                    symbol_type: z.enum(['file', 'module', 'class', 'interface', 'method', 'function', 'field', 'test', 'package']).optional().describe("Filter by symbol type"),
                    language: z.string().optional().describe("Filter by programming language (e.g., 'typescript', 'python')"),
                    visibility: z.enum(['public', 'protected', 'internal', 'private']).optional().describe("Filter by visibility")
                })
            },
            async ({ query, limit, symbol_type, language, visibility }) => {
                await this.waitUntilReady();
                const nodes = this.graphEngine.nodeRepo.searchSymbols(query, limit || 10, {
                    symbol_type: symbol_type as any,
                    language,
                    visibility: visibility as any
                });
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(nodes.map(n => ({
                            qname: n.qualified_name,
                            type: n.symbol_type,
                            file: n.file_path,
                            language: n.language,
                            visibility: n.visibility,
                            signature: n.signature,
                            return_type: n.return_type
                        })), null, 2)
                    }]
                };
            }
        );

        // get_callers
        this.sdkServer.registerTool(
            "get_callers",
            {
                description: "Get all direct callers of a specific symbol.",
                inputSchema: z.object({
                    qualified_name: z.string().describe("The qualified name of the symbol to find callers for")
                })
            },
            async ({ qualified_name }) => {
                await this.waitUntilReady();
                const node = this.graphEngine.getNodeByQualifiedName(qualified_name);
                if (!node || node.id === undefined) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
                
                const edges = this.graphEngine.getIncomingEdges(node.id).filter(e => e.edge_type === 'calls' || e.edge_type === 'dynamic_calls');
                const callers = edges.map(e => {
                    const callerNode = this.graphEngine.getNodeById(e.from_id);
                    return {
                        qname: callerNode?.qualified_name,
                        type: callerNode?.symbol_type,
                        file: callerNode?.file_path,
                        line: e.call_site_line,
                        dynamic: e.dynamic
                    };
                });
                return { content: [{ type: "text", text: JSON.stringify(callers, null, 2) }] };
            }
        );

        // get_callees
        this.sdkServer.registerTool(
            "get_callees",
            {
                description: "Get all symbols directly called by a specific symbol.",
                inputSchema: z.object({
                    qualified_name: z.string().describe("The qualified name of the symbol to find callees for")
                })
            },
            async ({ qualified_name }) => {
                await this.waitUntilReady();
                const node = this.graphEngine.getNodeByQualifiedName(qualified_name);
                if (!node || node.id === undefined) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
                
                const edges = this.graphEngine.getOutgoingEdges(node.id).filter(e => e.edge_type === 'calls' || e.edge_type === 'dynamic_calls');
                const callees = edges.map(e => {
                    const calleeNode = this.graphEngine.getNodeById(e.to_id);
                    return {
                        qname: calleeNode?.qualified_name,
                        type: calleeNode?.symbol_type,
                        file: calleeNode?.file_path,
                        line: e.call_site_line,
                        dynamic: e.dynamic
                    };
                });
                return { content: [{ type: "text", text: JSON.stringify(callees, null, 2) }] };
            }
        );

        // get_related_tests
        this.sdkServer.registerTool(
            "get_related_tests",
            {
                description: "Get all test symbols associated with a specific production symbol.",
                inputSchema: z.object({
                    qualified_name: z.string().describe("The qualified name of the production symbol")
                })
            },
            async ({ qualified_name }) => {
                await this.waitUntilReady();
                const node = this.graphEngine.getNodeByQualifiedName(qualified_name);
                if (!node || node.id === undefined) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
                
                // Find edges where edge_type is 'tests'
                const incomingTests = this.graphEngine.getIncomingEdges(node.id).filter(e => e.edge_type === 'tests');
                const outgoingTests = this.graphEngine.getOutgoingEdges(node.id).filter(e => e.edge_type === 'tests');
                
                const testNodes = [...incomingTests, ...outgoingTests].map(e => {
                    const testId = e.edge_type === 'tests' ? (incomingTests.includes(e) ? e.from_id : e.to_id) : -1;
                    const testNode = this.graphEngine.getNodeById(testId);
                    return {
                        qname: testNode?.qualified_name,
                        file: testNode?.file_path,
                        type: testNode?.symbol_type
                    };
                }).filter(n => n.qname !== undefined);

                return { content: [{ type: "text", text: JSON.stringify(testNodes, null, 2) }] };
            }
        );

        // perform_clustering
        this.sdkServer.registerTool(
            "perform_clustering",
            {
                description: "Execute the semantic clustering algorithm to group symbols into logical modules (Core, Utility, Domain).",
                inputSchema: z.object({})
            },
            async () => {
                await this.waitUntilReady();
                const result = await this.graphEngine.performClustering();
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(result, null, 2)
                    }]
                };
            }
        );

        // get_symbol_details
        this.sdkServer.registerTool(
            "get_symbol_details",
            {
                description: "Get comprehensive details about a specific symbol by its qualified name, including its type, location, metrics (complexity, fan-in/out), and source code snippet.",
                inputSchema: z.object({
                    qualified_name: z.string().describe("The full qualified name of the symbol (e.g., 'src/utils/paths.ts/getDatabasePath')"),
                    include_source: z.boolean().optional().default(true).describe("Whether to include the source code snippet (default: true)"),
                    summary_only: z.boolean().optional().default(false).describe("If true, returns only basic metadata and metrics without relations or source code.")
                })
            },
            async ({ qualified_name, include_source, summary_only }) => {
                await this.waitUntilReady();
                const node = this.graphEngine.getNodeByQualifiedName(qualified_name);
                if (!node || node.id === undefined) {
                    return {
                        isError: true,
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                error_code: CynapxErrorCode.SYMBOL_NOT_FOUND,
                                message: `Symbol '${qualified_name}' not found.`,
                                qualified_name
                            }, null, 2)
                        }]
                    };
                }

                let text = `### Symbol: ${node.qualified_name}\n`;
                text += `- **Type**: \`${node.symbol_type}\`\n`;
                if (node.modifiers && node.modifiers.length > 0) text += `- **Modifiers**: \`${node.modifiers.join(', ')}\`\n`;
                if (node.signature) text += `- **Signature**: \`${node.signature}\`\n`;
                if (node.return_type) text += `- **Return Type**: \`${node.return_type}\`\n`;
                if (node.field_type) text += `- **Field Type**: \`${node.field_type}\`\n`;
                text += `- **File**: \`${node.file_path}\` (line ${node.start_line}-${node.end_line})\n`;
                
                if (node.remote_project_path) {
                    text += `- **Remote Project**: \`${node.remote_project_path}\` (Boundaryless Discovery)\n`;
                }

                text += `\n#### Metrics:\n`;
                if (node.loc !== undefined) text += `- **LOC**: ${node.loc}\n`;
                if (node.cyclomatic !== undefined) text += `- **Cyclomatic Complexity**: ${node.cyclomatic}\n`;
                text += `- **Static Coupling**: Fan-in: ${node.fan_in || 0}, Fan-out: ${node.fan_out || 0}\n`;
                text += `- **Dynamic Coupling**: Fan-in: ${node.fan_in_dynamic || 0}, Fan-out: ${node.fan_out_dynamic || 0}\n`;
                
                if (summary_only) {
                    return { content: [{ type: "text", text }] };
                }

                const outgoing = this.graphEngine.getOutgoingEdges(node.id);
                const incoming = this.graphEngine.getIncomingEdges(node.id);
                
                text += `\n#### Relationships:\n`;
                text += `- **Outgoing Edges**: ${outgoing.length}\n`;
                text += `- **Incoming Edges**: ${incoming.length}\n`;

                if (include_source === false) {
                    return { content: [{ type: "text", text }] };
                }

                // Read source code from file with Path Traversal Protection
                try {
                    if (this.securityProvider) {
                        this.securityProvider.validatePath(node.file_path);
                    }
                    
                        const content = fs.readFileSync(node.file_path, 'utf8');
                        const lines = content.split('\n');
                        const sourceCodeLines = lines.slice(node.start_line - 1, node.end_line);
                        
                        const lang = node.file_path.endsWith('.py') ? 'python' : 
                                     (node.file_path.endsWith('.ts') || node.file_path.endsWith('.tsx')) ? 'typescript' : 'javascript';
                        
                        // Smart Pruning: if more than 100 lines, truncate to 50
                        const displayCode = sourceCodeLines.length > 100 ? 
                            sourceCodeLines.slice(0, 50).join('\n') + '\n\n// ... [Truncated for Token Optimization: Use read_file for full content] ...' :
                            sourceCodeLines.join('\n');

                        text += `\n#### Source Code Snippet:\n\`\`\`${lang}\n${displayCode}\n\`\`\`\n`;
                } catch (err: any) {
                    if (err.code === CynapxErrorCode.PATH_TRAVERSAL_DENIED) {
                        text += `\n> [!CAUTION]\n> **Security Warning**: Access to file outside project directory denied. (ErrorCode: ${CynapxErrorCode.PATH_TRAVERSAL_DENIED})\n`;
                    } else {
                        text += `\n> [!WARNING]\n> Could not read source code: ${err}\n`;
                    }
                }

                return {
                    content: [{
                        type: "text",
                        text: text
                    }]
                };
            }
        );

        // analyze_impact
        this.sdkServer.registerTool(
            "analyze_impact",
            {
                description: "Analyze the ripple effect of changing a symbol by identifying all other symbols that depend on it (transitively). Essential for risk assessment before refactoring.",
                inputSchema: z.object({
                    qualified_name: z.string().describe("The qualified name of the symbol to analyze"),
                    max_depth: z.number().optional().default(3).describe("Maximum depth of impact analysis traversal"),
                    use_cache: z.boolean().optional().default(true).describe("Whether to use cached results for faster response (default: true)")
                })
            },
            async ({ qualified_name, max_depth, use_cache }) => {
                await this.waitUntilReady();
                const targetNode = this.graphEngine.getNodeByQualifiedName(qualified_name);
                if (!targetNode || targetNode.id === undefined) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Symbol not found" }]
                    };
                }
                const results = this.graphEngine.traverse(targetNode.id, 'BFS', {
                    direction: 'incoming',
                    maxDepth: max_depth || 3,
                    useCache: use_cache
                });

                const formatted = results.map(r => {
                    const pathSteps = [...r.path].reverse();
                    const impactPath = pathSteps.map((step, index) => {
                        const n = this.graphEngine.getNodeById(step.nodeId);
                        const qname = n ? n.qualified_name : 'unknown';
                        if (index < pathSteps.length - 1) {
                            const edge = step.edge;
                            const lineInfo = edge?.call_site_line ? ` (line ${edge.call_site_line})` : '';
                            return `${qname}${lineInfo}`;
                        }
                        return qname;
                    });
                    return {
                        node: r.node.qualified_name,
                        distance: r.distance,
                        impact_path: impactPath.join(' -> ')
                    };
                });

                return {
                    content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }]
                };
            }
        );

        // get_hotspots
        this.sdkServer.registerTool(
            "get_hotspots",
            {
                description: "Identify potential technical debt or complex areas by finding symbols with high complexity or high coupling (fan-in/out).",
                inputSchema: z.object({
                    metric: z.enum(['cyclomatic', 'fan_in', 'fan_out', 'loc']).describe("The metric to use for identifying hotspots (cyclomatic: logic complexity, fan_in: high dependency, fan_out: high usage)"),
                    threshold: z.number().optional().default(0).describe("Minimum metric value to filter results"),
                    symbol_type: z.string().optional().describe("Filter results by symbol type (e.g., 'function', 'class')")
                })
            },
            async ({ metric, threshold, symbol_type }) => {
                await this.waitUntilReady();
                const db = (this.graphEngine.nodeRepo as any).db;
                
                // Whitelist allowed metrics to prevent SQL Injection
                const allowedMetrics = ['cyclomatic', 'fan_in', 'fan_out', 'loc'];
                if (!allowedMetrics.includes(metric)) {
                    return { isError: true, content: [{ type: "text", text: "Invalid metric" }] };
                }

                const query = `
                    SELECT * FROM nodes 
                    WHERE ${metric} >= ? 
                    ${symbol_type ? 'AND symbol_type = ?' : ''}
                    ORDER BY ${metric} DESC
                    LIMIT 20
                `;
                const stmt = db.prepare(query);
                const params = symbol_type ? [threshold || 0, symbol_type] : [threshold || 0];
                const rows = stmt.all(...params);
                const hotspots = rows.map((row: any) => ({
                    qualified_name: row.qualified_name,
                    symbol_type: row.symbol_type,
                    [metric]: row[metric]
                }));
                return {
                    content: [{ type: "text", text: JSON.stringify(hotspots, null, 2) }]
                };
            }
        );

        // export_graph
        this.sdkServer.registerTool(
            "export_graph",
            {
                description: "Generate a Mermaid-compatible diagram representing a sub-graph of the code knowledge graph, centered around a root symbol.",
                inputSchema: z.object({
                    root_qname: z.string().optional().describe("The qualified name of the root symbol to start the export from"),
                    max_depth: z.number().optional().default(2).describe("Maximum depth of relationships to include")
                })
            },
            async ({ root_qname, max_depth }) => {
                await this.waitUntilReady();
                const mermaid = await this.graphEngine.exportToMermaid({
                    rootQName: root_qname,
                    maxDepth: max_depth
                });

                let text = `### Knowledge Graph Visualization\n`;
                if (root_qname) {
                    text += `- **Root**: \`${root_qname}\`\n`;
                }
                text += `- **Max Depth**: ${max_depth}\n\n`;
                text += `\`\`\`mermaid\n${mermaid}\n\`\`\``;

                return {
                    content: [{ 
                        type: "text", 
                        text: text
                    }]
                };
            }
        );

        // check_consistency
        this.sdkServer.registerTool(
            "check_consistency",
            {
                description: "Validate and optionally repair the integrity of the knowledge graph against the current state of the file system and Git history.",
                inputSchema: z.object({
                    repair: z.boolean().optional().default(false).describe("If true, attempts to re-index inconsistent files to fix the graph"),
                    force: z.boolean().optional().default(false).describe("If true, forces a full re-index of all files in the project")
                })
            },
            async ({ repair, force }) => {
                await this.waitUntilReady();
                if (!this.consistencyChecker) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Consistency checker not available in this session" }]
                    };
                }
                if (this.isCheckingConsistency) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "A consistency check is already in progress. Please wait." }]
                    };
                }
                this.isCheckingConsistency = true;
                try {
                    const results = await this.consistencyChecker.validate(repair || false, force || false);
                    return {
                        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
                    };
                } finally {
                    this.isCheckingConsistency = false;
                }
            }
        );

        // purge_index
        this.sdkServer.registerTool(
            "purge_index",
            {
                description: "Completely delete the local database index for the current project. Optionally remove the project from the central registry.",
                inputSchema: z.object({
                    confirm: z.boolean().optional().default(false).describe("Explicit confirmation to proceed with the deletion"),
                    unregister: z.boolean().optional().default(false).describe("If true, also remove the project from the central registry")
                })
            },
            async ({ confirm, unregister }) => {
                // Wait for readyPromise but don't strictly require isInitialized to allow purging broken setups
                await this.readyPromise; 

                if (!confirm) {
                    return {
                        content: [{ 
                            type: "text", 
                            text: "WARNING: You are about to completely delete the index for this project. This cannot be undone. To proceed, please call this tool again with 'confirm: true'." 
                        }]
                    };
                }

                // Get current project path before purging
                const currentPath = process.cwd();
                const dbPath = getDatabasePath(currentPath);

                try {
                    console.error(`Purging database: ${dbPath}`);
                    
                    if (this.onPurgeCallback) {
                        await this.onPurgeCallback();
                    }

                    // Wait a moment for OS to release file handles
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Reset internal state
                    this.isInitialized = false;
                    this.consistencyChecker = undefined;

                    // Delete the physical files (Main DB + WAL + SHM)
                    const filesToDelete = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
                    for (const f of filesToDelete) {
                        if (fs.existsSync(f)) {
                            fs.unlinkSync(f);
                        }
                    }

                    if (unregister) {
                        const { removeFromRegistry } = require('../utils/paths');
                        removeFromRegistry(currentPath);
                    }

                    return {
                        content: [{ type: "text", text: `Successfully purged all index data. The database file at ${dbPath} has been deleted.${unregister ? ' Project removed from registry.' : ''} Server is now in PENDING mode.` }]
                    };
                } catch (err) {
                    return { isError: true, content: [{ type: "text", text: `Failed to purge index: ${err}` }] };
                }
            }
        );
    }

    public async start() {
        const transport = new StdioServerTransport();
        await this.sdkServer.connect(transport);
        console.error("Cynapx MCP Server started on stdio");
    }

    public async close() {
        await this.sdkServer.close();
        console.error("Cynapx MCP Server closed");
    }

    /**
     * Connects a new transport to the MCP server.
     * Used for SSE or other multi-connection transports.
     */
    public async connectTransport(transport: any) {
        await this.sdkServer.connect(transport);
    }
}

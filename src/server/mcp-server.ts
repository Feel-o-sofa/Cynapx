import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GraphEngine } from '../graph/graph-engine';
import { ConsistencyChecker } from '../indexer/consistency-checker';
import * as fs from 'fs';
import * as path from 'path';

export class McpServer {
    private sdkServer: SdkMcpServer;
    private isCheckingConsistency: boolean = false;
    private readyPromise: Promise<void>;
    private resolveReady?: () => void;

    constructor(
        private graphEngine: GraphEngine,
        private consistencyChecker?: ConsistencyChecker
    ) {
        this.sdkServer = new SdkMcpServer({
            name: "cynapx",
            version: "1.0.0"
        });

        this.readyPromise = new Promise((resolve) => {
            this.resolveReady = resolve;
        });

        this.registerTools();
        this.registerResources();
        this.registerPrompts();
    }

    public markReady() {
        if (this.resolveReady) {
            this.resolveReady();
            console.error("Cynapx MCP Server marked as READY for requests");
        }
    }

    private async waitUntilReady() {
        await this.readyPromise;
    }

    private registerResources() {
        this.sdkServer.registerResource(
            "Graph Summary",
            "graph://summary",
            {
                description: "A summary of the current code knowledge graph"
            },
            async (uri) => {
                await this.waitUntilReady();
                return {
                    contents: [{
                        uri: uri.href,
                        mimeType: "application/json",
                        text: await this.getSummaryText()
                    }]
                };
            }
        );
    }

    private async getSummaryText(): Promise<string> {
        const db = (this.graphEngine.nodeRepo as any).db;
        const nodeCount = db.prepare("SELECT COUNT(*) as count FROM nodes").get().count;
        const edgeCount = db.prepare("SELECT COUNT(*) as count FROM edges").get().count;
        const fileCount = db.prepare("SELECT COUNT(DISTINCT file_path) as count FROM nodes").get().count;

        return JSON.stringify({
            nodes: nodeCount,
            edges: edgeCount,
            files: fileCount,
            last_updated: new Date().toISOString()
        }, null, 2);
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
    }

    public setConsistencyChecker(checker: ConsistencyChecker) {
        this.consistencyChecker = checker;
    }

    private registerTools() {
        // search_symbols
        this.sdkServer.registerTool(
            "search_symbols",
            {
                description: "Search for symbols (functions, classes, variables) in the code knowledge graph using a search query. Returns basic metadata for matching symbols.",
                inputSchema: z.object({
                    query: z.string().describe("Search query for symbol names (supports partial matches)"),
                    limit: z.number().optional().default(10).describe("Maximum number of results to return")
                })
            },
            async ({ query, limit }) => {
                await this.waitUntilReady();
                const nodes = this.graphEngine.nodeRepo.searchSymbols(query, limit || 10);
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(nodes.map(n => ({
                            qname: n.qualified_name,
                            type: n.symbol_type,
                            file: n.file_path
                        })), null, 2)
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
                    qualified_name: z.string().describe("The full qualified name of the symbol (e.g., 'src/utils/paths.ts/getDatabasePath')")
                })
            },
            async ({ qualified_name }) => {
                await this.waitUntilReady();
                const node = this.graphEngine.getNodeByQualifiedName(qualified_name);
                if (!node || node.id === undefined) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Symbol not found" }]
                    };
                }
                const outgoing = this.graphEngine.getOutgoingEdges(node.id);
                const incoming = this.graphEngine.getIncomingEdges(node.id);

                let text = `### Symbol: ${node.qualified_name}\n`;
                text += `- **Type**: ${node.symbol_type}\n`;
                text += `- **File**: ${node.file_path} (line ${node.start_line}-${node.end_line})\n`;
                text += `- **Outgoing Edges**: ${outgoing.length}\n`;
                text += `- **Incoming Edges**: ${incoming.length}\n`;
                
                if (node.cyclomatic !== undefined) text += `- **Cyclomatic Complexity**: ${node.cyclomatic}\n`;
                if (node.fan_in !== undefined) text += `- **Fan-in**: ${node.fan_in}\n`;
                if (node.fan_out !== undefined) text += `- **Fan-out**: ${node.fan_out}\n`;

                // Read source code from file with Path Traversal Protection
                try {
                    const projectPath = (this.consistencyChecker as any)?.projectPath;
                    const absolutePath = path.resolve(node.file_path);
                    
                    if (projectPath && !absolutePath.toLowerCase().startsWith(path.resolve(projectPath).toLowerCase())) {
                        text += `\n*(Security Warning: Access to file outside project directory denied.)*\n`;
                    } else if (fs.existsSync(node.file_path)) {
                        const content = fs.readFileSync(node.file_path, 'utf8');
                        const lines = content.split('\n');
                        const sourceCode = lines.slice(node.start_line - 1, node.end_line).join('\n');
                        
                        const lang = node.file_path.endsWith('.py') ? 'python' : 
                                     (node.file_path.endsWith('.ts') || node.file_path.endsWith('.tsx')) ? 'typescript' : 'javascript';
                        text += `\n#### Source Code:\n\`\`\`${lang}\n${sourceCode}\n\`\`\`\n`;
                    }
                } catch (err) {
                    text += `\n*(Could not read source code: ${err})*\n`;
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
                    max_depth: z.number().optional().default(3).describe("Maximum depth of impact analysis traversal")
                })
            },
            async ({ qualified_name, max_depth }) => {
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
                    maxDepth: max_depth || 3
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
                return {
                    content: [{ 
                        type: "text", 
                        text: `Here is the Mermaid graph definition:\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`` 
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
                    repair: z.boolean().optional().default(false).describe("If true, attempts to re-index inconsistent files to fix the graph")
                })
            },
            async ({ repair }) => {
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
                    const results = await this.consistencyChecker.validate(repair || false);
                    return {
                        content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
                    };
                } finally {
                    this.isCheckingConsistency = false;
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
}

import { GraphEngine } from '../graph/graph-engine';
import { ConsistencyChecker } from '../indexer/consistency-checker';
import * as readline from 'readline';

export class McpServer {
    constructor(
        private graphEngine: GraphEngine,
        private consistencyChecker?: ConsistencyChecker
    ) { }

    public setConsistencyChecker(checker: ConsistencyChecker) {
        this.consistencyChecker = checker;
    }

    public start() {
        const rl = readline.createInterface({
            input: process.stdin,
            terminal: false
        });

        rl.on('line', async (line) => {
            if (!line.trim()) return;
            try {
                const request = JSON.parse(line);
                if (request.method === 'notifications/initialized') {
                    return; // Ignore initialized notification
                }
                const response = await this.handleRequest(request);
                if (request.id !== undefined) {
                    process.stdout.write(JSON.stringify(response) + '\n');
                }
            } catch (err: any) {
                // If we have a valid request ID, try to send an error response
                try {
                    const errorRequest = JSON.parse(line);
                    if (errorRequest.id !== undefined) {
                        process.stdout.write(JSON.stringify({
                            jsonrpc: '2.0',
                            id: errorRequest.id,
                            error: { code: -32603, message: err.message || 'Internal error' }
                        }) + '\n');
                    }
                } catch {
                    // Total failure, ignore
                }
            }
        });
    }

    private async handleRequest(request: any): Promise<any> {
        const { method, params, id } = request;

        switch (method) {
            case 'initialize':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: { name: 'cynapx', version: '1.0.0' }
                    }
                };

            case 'tools/list':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        tools: [
                            {
                                name: 'search_symbols',
                                description: 'Search for symbols in the code knowledge graph',
                                inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }
                            },
                            {
                                name: 'analyze_impact',
                                description: 'Analyze the impact of changing a symbol',
                                inputSchema: { type: 'object', properties: { qualified_name: { type: 'string' }, max_depth: { type: 'number' } }, required: ['qualified_name'] }
                            },
                            {
                                name: 'get_symbol_details',
                                description: 'Get detailed information about a symbol including definitions and relationships',
                                inputSchema: { type: 'object', properties: { qualified_name: { type: 'string' } }, required: ['qualified_name'] }
                            },
                            {
                                name: 'get_hotspots',
                                description: 'Find code hotspots based on metrics like cyclomatic complexity or fan-in',
                                inputSchema: {
                                    type: 'object',
                                    properties: {
                                        metric: { type: 'string', enum: ['cyclomatic', 'fan_in', 'fan_out', 'loc'] },
                                        threshold: { type: 'number' },
                                        symbol_type: { type: 'string' }
                                    },
                                    required: ['metric']
                                }
                            },
                            {
                                name: 'export_graph',
                                description: 'Export a portion of the graph in Mermaid format for visualization',
                                inputSchema: {
                                    type: 'object',
                                    properties: {
                                        root_qname: { type: 'string' },
                                        max_depth: { type: 'number' }
                                    }
                                }
                            },
                            {
                                name: 'check_consistency',
                                description: 'Validate and optionally repair the index consistency against the file system and Git',
                                inputSchema: { type: 'object', properties: { repair: { type: 'boolean' } } }
                            }
                        ]
                    }
                };

            case 'tools/call':
                const toolResult = await this.callTool(params.name, params.arguments);
                return { jsonrpc: '2.0', id, result: toolResult };

            default:
                return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
        }
    }

    private isCheckingConsistency: boolean = false;

    private async callTool(name: string, args: any): Promise<any> {
        try {
            switch (name) {
                case 'search_symbols': {
                    const nodes = this.graphEngine.nodeRepo.searchSymbols(args.query, args.limit || 10);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(nodes.map(n => ({ qname: n.qualified_name, type: n.symbol_type, file: n.file_path })), null, 2) }]
                    };
                }

                case 'get_symbol_details': {
                    const node = this.graphEngine.getNodeByQualifiedName(args.qualified_name);
                    if (!node || node.id === undefined) return { isError: true, content: [{ type: 'text', text: 'Symbol not found' }] };
                    const outgoing = this.graphEngine.getOutgoingEdges(node.id);
                    const incoming = this.graphEngine.getIncomingEdges(node.id);
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ node, outgoing_count: outgoing.length, incoming_count: incoming.length }, null, 2) }]
                    };
                }

                case 'analyze_impact': {
                    const targetNode = this.graphEngine.getNodeByQualifiedName(args.qualified_name);
                    if (!targetNode || targetNode.id === undefined) return { isError: true, content: [{ type: 'text', text: 'Symbol not found' }] };
                    const results = this.graphEngine.traverse(targetNode.id, 'BFS', { direction: 'incoming', maxDepth: args.max_depth || 3 });

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
                        content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }]
                    };
                }

                case 'get_hotspots': {
                    const { metric, threshold, symbol_type } = args;
                    const db = (this.graphEngine.nodeRepo as any).db;
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
                        content: [{ type: 'text', text: JSON.stringify(hotspots, null, 2) }]
                    };
                }

                case 'export_graph': {
                    const mermaid = await this.graphEngine.exportToMermaid({
                        rootQName: args.root_qname,
                        maxDepth: args.max_depth
                    });
                    return {
                        content: [{ type: 'text', text: mermaid }]
                    };
                }

                case 'check_consistency': {
                    if (!this.consistencyChecker) {
                        return { isError: true, content: [{ type: 'text', text: 'Consistency checker not available in this session' }] };
                    }
                    if (this.isCheckingConsistency) {
                        return { isError: true, content: [{ type: 'text', text: 'A consistency check is already in progress. Please wait.' }] };
                    }
                    this.isCheckingConsistency = true;
                    try {
                        const results = await this.consistencyChecker.validate(args.repair || false);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
                        };
                    } finally {
                        this.isCheckingConsistency = false;
                    }
                }

                default:
                    return { isError: true, content: [{ type: 'text', text: `Tool not found: ${name}` }] };
            }
        } catch (e: any) {
            return { isError: true, content: [{ type: 'text', text: e.message }] };
        }
    }
}

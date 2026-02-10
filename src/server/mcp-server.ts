
import { GraphEngine } from '../graph/graph-engine';
import * as readline from 'readline';

export class McpServer {
    constructor(private graphEngine: GraphEngine) {}

    public start() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        rl.on('line', async (line) => {
            try {
                const request = JSON.parse(line);
                const response = await this.handleRequest(request);
                process.stdout.write(JSON.stringify(response) + '\n');
            } catch (err) {
                // Ignore non-json or invalid requests
            }
        });
    }

    private async handleRequest(request: any): Promise<any> {
        const { method, params, id } = request;

        switch (method) {
            case 'initialize':
                return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'cynapx', version: '1.0.0' } } };
            
            case 'tools/list':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        tools: [
                            {
                                name: 'search_symbols',
                                description: 'Search for symbols in the code knowledge graph',
                                inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
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

    private async callTool(name: string, args: any): Promise<any> {
        try {
            switch (name) {
                case 'search_symbols':
                    const nodes = this.graphEngine.nodeRepo.searchSymbols(args.query, args.limit || 10);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(nodes.map(n => ({ qname: n.qualified_name, type: n.symbol_type, file: n.file_path })), null, 2) }]
                    };

                case 'get_symbol_details':
                    const node = this.graphEngine.getNodeByQualifiedName(args.qualified_name);
                    if (!node || node.id === undefined) return { isError: true, content: [{ type: 'text', text: 'Symbol not found' }] };
                    const outgoing = this.graphEngine.getOutgoingEdges(node.id);
                    const incoming = this.graphEngine.getIncomingEdges(node.id);
                    return {
                        content: [{ type: 'text', text: JSON.stringify({ node, outgoing_count: outgoing.length, incoming_count: incoming.length }, null, 2) }]
                    };

                case 'analyze_impact':
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

                default:
                    return { isError: true, content: [{ type: 'text', text: `Tool not found: ${name}` }] };
            }
        } catch (e: any) {
            return { isError: true, content: [{ type: 'text', text: e.message }] };
        }
    }
}

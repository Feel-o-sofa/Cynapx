/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import express, { Request, Response } from 'express';
import * as fs from 'fs';
import { GraphEngine, TraversalResult } from '../graph/graph-engine';
import { CodeNode, CodeEdge, SymbolType, Visibility } from '../types';

export class ApiServer {
    private app: express.Application;

    constructor(private graphEngine: GraphEngine) {
        this.app = express();
        this.app.use(express.json());
        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        const AUTH_TOKEN = process.env.KNOWLEDGE_TOOL_TOKEN || 'dev-token-1234';

        this.app.use((req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
                return res.status(401).json({
                    error_code: 'UNAUTHORIZED',
                    message: 'Invalid or missing Bearer Token'
                });
            }
            next();
        });
    }

    private setupRoutes(): void {
        // 3.1 Get Symbol API
        this.app.post('/api/symbol/get', this.handleGetSymbol.bind(this));

        // 3.2 Callers API
        this.app.post('/api/graph/callers', this.handleGetCallers.bind(this));

        // 3.3 Callees API
        this.app.post('/api/graph/callees', this.handleGetCallees.bind(this));

        // 3.4 Impact Analysis API
        this.app.post('/api/analysis/impact', this.handleImpactAnalysis.bind(this));

        // 3.5 Hotspots API
        this.app.post('/api/analysis/hotspots', this.handleHotspots.bind(this));

        // 3.6 Tests API
        this.app.post('/api/analysis/tests', this.handleTests.bind(this));

        // 3.7 Search API (Phase E)
        this.app.post('/api/search/symbols', this.handleSymbolSearch.bind(this));

        // 3.8 Export API (Task 14)
        this.app.post('/api/graph/export', this.handleExportGraph.bind(this));
    }

    private async handleExportGraph(req: Request, res: Response) {
        const { root_qname, max_depth, format } = req.body;
        
        if (format && format !== 'mermaid') {
            return res.status(400).json({ error_code: 'INVALID_FORMAT', message: 'Only "mermaid" format is supported currently.' });
        }

        try {
            const result = await this.graphEngine.exportToMermaid({
                rootQName: root_qname,
                maxDepth: max_depth
            });
            res.json({ format: 'mermaid', content: result });
        } catch (error) {
            res.status(500).json({ error_code: 'EXPORT_FAILED', message: String(error) });
        }
    }

    private handleGetSymbol(req: Request, res: Response) {
        const { qualified_name } = req.body;
        const node = this.graphEngine.getNodeByQualifiedName(qualified_name);

        if (!node || node.id === undefined) {
            return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND', message: 'Symbol not found', related_symbol: qualified_name });
        }

        const outgoing = this.graphEngine.getOutgoingEdges(node.id);
        const incoming = this.graphEngine.getIncomingEdges(node.id);

        res.json({
            node: this.mapToGraphNode(node),
            outgoing_edges: outgoing.map((e: CodeEdge) => this.mapToGraphEdge(e, node.id!)),
            incoming_edges: incoming.map((e: CodeEdge) => this.mapToGraphEdge(e, node.id!))
        });
    }

    private formatPath(path: any[], direction: 'incoming' | 'outgoing'): string[] {
        // Build a readable path: A -> B -> C
        // TraversalResult.path is [Start, ..., Current]
        
        // For 'incoming' (Callers/Impact): [ChangedSymbol, Caller1, Caller2, ...]
        // We want: [CallerN, ..., Caller1, ChangedSymbol]
        
        // For 'outgoing' (Callees): [StartSymbol, Callee1, Callee2, ...]
        // We want: [StartSymbol, Callee1, ..., CalleeN]

        const steps = direction === 'incoming' ? [...path].reverse() : path;
        
        return steps.map((step, index) => {
            const n = this.graphEngine.nodeRepo.getNodeById(step.nodeId);
            const qname = n ? n.qualified_name : 'unknown';
            
            if (index < steps.length - 1) {
                // For 'incoming', the edge is on the current step (A calls B)
                // For 'outgoing', the edge is on the NEXT step (A calls B)
                const edge = direction === 'incoming' ? step.edge : steps[index + 1].edge;
                const lineInfo = edge?.call_site_line ? ` (line ${edge.call_site_line})` : '';
                return `${qname}${lineInfo}`;
            }
            return qname;
        });
    }

    private handleGetCallers(req: Request, res: Response) {
        const { symbol, max_depth } = req.body;
        const node = this.graphEngine.getNodeByQualifiedName(symbol.qualified_name);

        if (!node || node.id === undefined) {
            return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND', message: 'Symbol not found', related_symbol: symbol.qualified_name });
        }

        const results = this.graphEngine.traverse(node.id, 'BFS', { direction: 'incoming', maxDepth: max_depth || 1 });
        res.json({
            root: this.mapToGraphNode(node),
            callers: results.filter(r => r.node.id !== node.id).map(r => ({
                node: this.mapToGraphNode(r.node),
                distance: r.distance,
                path: this.formatPath(r.path, 'incoming')
            }))
        });
    }

    private handleGetCallees(req: Request, res: Response) {
        const { symbol, max_depth } = req.body;
        const node = this.graphEngine.getNodeByQualifiedName(symbol.qualified_name);

        if (!node || node.id === undefined) {
            return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND', message: 'Symbol not found', related_symbol: symbol.qualified_name });
        }

        const results = this.graphEngine.traverse(node.id, 'BFS', { direction: 'outgoing', maxDepth: max_depth || 1 });
        res.json({
            root: this.mapToGraphNode(node),
            callees: results.filter(r => r.node.id !== node.id).map(r => ({
                node: this.mapToGraphNode(r.node),
                distance: r.distance,
                path: this.formatPath(r.path, 'outgoing')
            }))
        });
    }

    private handleImpactAnalysis(req: Request, res: Response) {
        const { symbol, max_depth } = req.body;
        const node = this.graphEngine.getNodeByQualifiedName(symbol.qualified_name);

        if (!node || node.id === undefined) {
            return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND', message: 'Symbol not found', related_symbol: symbol.qualified_name });
        }

        const results = this.graphEngine.traverse(node.id, 'BFS', { direction: 'incoming', maxDepth: max_depth || 3 });

        const affected_nodes = results.map(r => ({
            node: this.mapToGraphNode(r.node),
            impact_path: this.formatPath(r.path, 'incoming'),
            distance: r.distance
        }));

        res.json({
            affected_nodes: affected_nodes
        });
    }

    private handleHotspots(req: Request, res: Response) {
        const { metric, threshold, symbol_type } = req.body;
        const nodeRepo = this.graphEngine.nodeRepo;
        const db = (nodeRepo as any).db;
        const query = `
            SELECT * FROM nodes 
            WHERE ${metric} >= ? 
            ${symbol_type ? 'AND symbol_type = ?' : ''}
            ORDER BY ${metric} DESC
            LIMIT 100
        `;

        const stmt = db.prepare(query);
        const params = symbol_type ? [threshold || 0, symbol_type] : [threshold || 0];
        const rows = stmt.all(...params);

        const hotspots = rows.map((row: any) => ({
            node: this.mapToGraphNode(nodeRepo.mapRowToNode(row)), // nodeRepo['mapRowToNode'] -> nodeRepo.mapRowToNode
            metric_value: row[metric]
        }));

        res.json({ hotspots });
    }

    private handleTests(req: Request, res: Response) {
        const { symbol } = req.body;
        const nodeRepo = this.graphEngine.nodeRepo;
        const node = nodeRepo.getNodeByQualifiedName(symbol.qualified_name);

        if (!node || node.id === undefined) {
            return res.status(404).json({ error_code: 'SYMBOL_NOT_FOUND', message: 'Symbol not found' });
        }

        // Search for nodes in files containing 'test' or 'spec' that call this node
        const callers = this.graphEngine.getIncomingEdges(node.id);
        const tests = callers
            .map(e => nodeRepo.getNodeById(e.from_id))
            .filter((n): n is CodeNode => !!n && (n.file_path.includes('test') || n.file_path.includes('spec')))
            .map(n => this.mapToGraphNode(n));

        res.json({
            production_node: this.mapToGraphNode(node),
            tests
        });
    }

    private handleSymbolSearch(req: Request, res: Response) {
        const { query, limit } = req.body;
        if (!query) {
            return res.status(400).json({ error_code: 'INVALID_QUERY', message: 'Query string is required' });
        }

        const nodes = this.graphEngine.nodeRepo.searchSymbols(query, limit || 20);
        res.json({
            matches: nodes.map(node => ({
                symbol: {
                    qualified_name: node.qualified_name,
                    symbol_type: node.symbol_type
                },
                location: {
                    file_path: node.file_path,
                    start_line: node.start_line,
                    end_line: node.end_line
                }
            }))
        });
    }

    private mapToGraphNode(node: CodeNode) {
        return {
            id: node.id?.toString(),
            symbol: {
                qualified_name: node.qualified_name,
                symbol_type: node.symbol_type
            },
            location: {
                file_path: node.file_path,
                start_line: node.start_line,
                end_line: node.end_line
            },
            metrics: {
                loc: node.loc,
                cyclomatic: node.cyclomatic,
                fan_in: node.fan_in,
                fan_out: node.fan_out
            },
            last_updated_commit: node.last_updated_commit
        };
    }

    private mapToGraphEdge(edge: CodeEdge, centerId?: number) {
        return {
            from_id: edge.from_id.toString(),
            to_id: edge.to_id.toString(),
            edge_type: edge.edge_type,
            call_site_line: edge.call_site_line
        };
    }

    public start(port: number = 3000): void {
        const server = this.app.listen(port, () => {
            const address = server.address();
            const assignedPort = typeof address === 'string' ? port : address?.port;

            console.log(`Knowledge Tool API listening on port ${assignedPort}`);

            // Save port to file so test scripts can find it
            try {
                fs.writeFileSync('.server-port', String(assignedPort));
            } catch (err) {
                console.error('Failed to write .server-port file:', err);
            }
        });
    }
}

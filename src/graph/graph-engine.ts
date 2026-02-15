/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { NodeRepository } from '../db/node-repository';
import { EdgeRepository } from '../db/edge-repository';
import { CodeNode, CodeEdge, EdgeType } from '../types';

export type TraversalStrategy = 'DFS' | 'BFS';

export interface TraversalPathStep {
    nodeId: number;
    edge?: CodeEdge;
}

export interface TraversalResult {
    node: CodeNode;
    distance: number;
    path: TraversalPathStep[];
}

/**
 * GraphEngine implements the logic for graph traversal and symbol resolution.
 */
export class GraphEngine {
    private nodeCache = new Map<number, CodeNode>();
    private qnameCache = new Map<string, CodeNode>();
    private impactCache = new Map<string, { timestamp: number, results: TraversalResult[] }>();

    constructor(
        public nodeRepo: NodeRepository,
        private edgeRepo: EdgeRepository
    ) { }

    public getNodeByQualifiedName(qualifiedName: string): CodeNode | null {
        if (this.qnameCache.has(qualifiedName)) {
            return this.qnameCache.get(qualifiedName)!;
        }
        const node = this.nodeRepo.getNodeByQualifiedName(qualifiedName);
        if (node && node.id) {
            this.qnameCache.set(qualifiedName, node);
            this.nodeCache.set(node.id, node);
        }
        return node;
    }

    public getNodeById(id: number): CodeNode | null {
        if (this.nodeCache.has(id)) {
            return this.nodeCache.get(id)!;
        }
        const node = this.nodeRepo.getNodeById(id);
        if (node && node.id) {
            this.nodeCache.set(id, node);
            this.qnameCache.set(node.qualified_name, node);
        }
        return node;
    }

    /**
     * Checks if a node is a Shadow Node pointing to a remote project.
     */
    public isShadowNode(node: CodeNode): boolean {
        return !!node.remote_project_path;
    }

    public clearCache(): void {
        this.nodeCache.clear();
        this.qnameCache.clear();
        this.impactCache.clear();
    }

    public getOutgoingEdges(nodeId: number, edgeType?: EdgeType): CodeEdge[] {
        return this.edgeRepo.getOutgoingEdges(nodeId, edgeType);
    }

    public getIncomingEdges(nodeId: number, edgeType?: EdgeType): CodeEdge[] {
        return this.edgeRepo.getIncomingEdges(nodeId, edgeType);
    }

    /**
     * Returns all edges in the knowledge graph.
     */
    public getAllEdges(): CodeEdge[] {
        return this.edgeRepo.getAllEdges();
    }

    /**
     * Returns all nodes in the knowledge graph.
     */
    public getAllNodes(): CodeNode[] {
        return this.nodeRepo.getAllNodes();
    }

    /**
     * Executes the semantic clustering algorithm.
     * Groups symbols into logical clusters based on affinity and saves results to DB.
     */
    public async performClustering(): Promise<{ clusterCount: number, nodesClustered: number }> {
        const nodes = this.nodeRepo.getAllNodes();
        const edges = this.edgeRepo.getAllEdges();
        if (nodes.length === 0) return { clusterCount: 0, nodesClustered: 0 };

        // 1. Build Adjacency List for fast neighbor lookup
        const adjacency = new Map<number, Set<number>>();
        for (const edge of edges) {
            if (!adjacency.has(edge.from_id)) adjacency.set(edge.from_id, new Set());
            if (!adjacency.has(edge.to_id)) adjacency.set(edge.to_id, new Set());
            adjacency.get(edge.from_id)!.add(edge.to_id);
            adjacency.get(edge.to_id)!.add(edge.from_id); // Undirected for affinity
        }

        // 2. Simple Seed-based Community Detection
        const clusters: number[][] = [];
        const unvisited = new Set(nodes.filter(n => n.id !== undefined).map(n => n.id!));
        const nodeMap = new Map(nodes.map(n => [n.id!, n]));

        while (unvisited.size > 0) {
            const seedId = unvisited.values().next().value as number;
            unvisited.delete(seedId);

            const currentCluster: number[] = [seedId];
            const queue: number[] = [seedId];

            while (queue.length > 0) {
                const currentId = queue.shift()!;
                const neighbors = adjacency.get(currentId) || new Set<number>();

                for (const neighborId of neighbors) {
                    if (unvisited.has(neighborId)) {
                        // Calculate affinity to decide if neighbor belongs to this cluster
                        const affinity = this.calculateAffinity(currentId, neighborId, adjacency, nodeMap);
                        if (affinity > 0.3) { // Threshold for clustering
                            unvisited.delete(neighborId);
                            currentCluster.push(neighborId);
                            queue.push(neighborId);
                        }
                    }
                }
            }
            clusters.push(currentCluster);
        }

        // 3. Persist Clusters to Database
        await this.persistClusters(clusters, nodeMap);

        return {
            clusterCount: clusters.length,
            nodesClustered: nodes.length
        };
    }

    /**
     * Calculates logical affinity between two nodes.
     * Uses Jaccard similarity of neighbors and file proximity.
     */
    private calculateAffinity(
        idA: number,
        idB: number,
        adjacency: Map<number, Set<number>>,
        nodeMap: Map<number, CodeNode>
    ): number {
        const neighborsA = adjacency.get(idA) || new Set();
        const neighborsB = adjacency.get(idB) || new Set();

        // Jaccard Similarity of neighbors
        const intersection = new Set([...neighborsA].filter(x => neighborsB.has(x)));
        const union = new Set([...neighborsA, ...neighborsB]);
        const jaccard = union.size > 0 ? intersection.size / union.size : 0;

        // File Proximity (Bonus)
        const nodeA = nodeMap.get(idA);
        const nodeB = nodeMap.get(idB);
        const fileProximity = (nodeA && nodeB && nodeA.file_path === nodeB.file_path) ? 0.5 : 0;

        return jaccard + fileProximity;
    }

    private async persistClusters(clusters: number[][], nodeMap: Map<number, CodeNode>): Promise<void> {
        const db = (this.nodeRepo as any).db;
        db.prepare('DELETE FROM logical_clusters').run();
        db.prepare('UPDATE nodes SET cluster_id = NULL').run();

        for (let i = 0; i < clusters.length; i++) {
            const clusterNodes = clusters[i];
            if (clusterNodes.length < 2) {
                const node = nodeMap.get(clusterNodes[0]);
                if (node?.symbol_type !== 'file') continue;
            }

            // Semantic Classification
            let totalComplexity = 0;
            let totalFanIn = 0;
            let totalFanOut = 0;
            let maxCoreness = -1;
            let centralSymbol = '';

            for (const id of clusterNodes) {
                const node = nodeMap.get(id);
                if (node) {
                    const complexity = node.cyclomatic || 1;
                    const fanIn = node.fan_in || 0;
                    const fanOut = node.fan_out || 0;
                    
                    totalComplexity += complexity;
                    totalFanIn += fanIn;
                    totalFanOut += fanOut;

                    const coreness = fanOut * complexity;
                    if (coreness > maxCoreness) {
                        maxCoreness = coreness;
                        centralSymbol = node.qualified_name;
                    }
                }
            }

            const avgComplexity = totalComplexity / clusterNodes.length;
            
            // Classification heuristic
            let type: 'core' | 'utility' | 'domain' = 'domain';
            if (totalFanIn > totalFanOut * 2) type = 'utility';
            else if (totalFanOut > 5 && avgComplexity > 5) type = 'core';

            const name = `cluster_${i + 1}_${type}`;
            const stmt = db.prepare('INSERT INTO logical_clusters (name, cluster_type, avg_complexity, central_symbol_qname) VALUES (?, ?, ?, ?)');
            const result = stmt.run(name, type, avgComplexity, centralSymbol);
            const clusterId = result.lastInsertRowid as number;

            for (const nodeId of clusterNodes) {
                this.nodeRepo.updateCluster(nodeId, clusterId);
            }
        }
    }

    /**
     * Traverses the graph starting from a specific node using the given strategy.
     * Includes a hard limit on recursion/iteration depth to preserve invariants.
     */
    public traverse(
        startNodeId: number,
        strategy: TraversalStrategy,
        options: {
            maxDepth?: number;
            direction?: 'outgoing' | 'incoming';
            edgeType?: EdgeType;
            useCache?: boolean;
        } = {}
    ): TraversalResult[] {
        const maxDepth = options.maxDepth ?? 5;
        const direction = options.direction ?? 'outgoing';
        const edgeType = options.edgeType;
        const useCache = options.useCache ?? true;

        if (useCache && strategy === 'BFS') {
            const cacheKey = `${startNodeId}:${direction}:${edgeType}:${maxDepth}`;
            const cached = this.impactCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp < 60000)) { // 1 minute cache
                return cached.results;
            }
        }

        const results: TraversalResult[] = [];
        const visited = new Set<number>();

        if (strategy === 'BFS') {
            this.bfs(startNodeId, direction, edgeType, maxDepth, results, visited);
            
            if (useCache) {
                const cacheKey = `${startNodeId}:${direction}:${edgeType}:${maxDepth}`;
                this.impactCache.set(cacheKey, { timestamp: Date.now(), results });
            }
        } else {
            this.dfs(startNodeId, 0, [], direction, edgeType, maxDepth, results, visited);
        }

        return results;
    }

    /**
     * Retrieves nodes and edges for a subgraph, centered around a root symbol.
     */
    public async getGraphData(options: {
        rootQName?: string;
        maxDepth?: number;
    } = {}): Promise<{ nodes: CodeNode[], edges: CodeEdge[] }> {
        let nodesToExport: CodeNode[] = [];
        let edgesToExport: CodeEdge[] = [];

        if (options.rootQName) {
            const root = this.getNodeByQualifiedName(options.rootQName);
            if (!root || !root.id) return { nodes: [], edges: [] };

            const results = this.traverse(root.id, 'BFS', { maxDepth: options.maxDepth ?? 3 });
            nodesToExport = results.map(r => r.node);
            const nodeIds = new Set(nodesToExport.map(n => n.id!));

            for (const id of nodeIds) {
                const outgoing = this.getOutgoingEdges(id);
                for (const e of outgoing) {
                    if (nodeIds.has(e.to_id)) {
                        edgesToExport.push(e);
                    }
                }
            }
        } else {
            const allFiles = this.nodeRepo.searchSymbols('', 10).filter(n => n.symbol_type === 'file');
            const nodeIds = new Set<number>();
            
            for (const file of allFiles) {
                const results = this.traverse(file.id!, 'BFS', { maxDepth: 1 });
                results.forEach(r => {
                    nodesToExport.push(r.node);
                    nodeIds.add(r.node.id!);
                });
            }

            for (const id of nodeIds) {
                const outgoing = this.getOutgoingEdges(id);
                for (const e of outgoing) {
                    if (nodeIds.has(e.to_id)) {
                        edgesToExport.push(e);
                    }
                }
            }
        }

        // Return unique nodes
        const uniqueNodes = Array.from(new Map(nodesToExport.map(n => [n.id, n])).values());
        return { nodes: uniqueNodes, edges: edgesToExport };
    }

    public async exportToMermaid(options: {
        rootQName?: string;
        maxDepth?: number;
    } = {}): Promise<string> {
        let nodesToExport: CodeNode[] = [];
        let edgesToExport: CodeEdge[] = [];

        if (options.rootQName) {
            const root = this.getNodeByQualifiedName(options.rootQName);
            if (!root || !root.id) return 'graph TD\n  RootNotFound["Root Symbol Not Found"]';

            const results = this.traverse(root.id, 'BFS', { maxDepth: options.maxDepth ?? 3 });
            nodesToExport = results.map(r => r.node);
            const nodeIds = new Set(nodesToExport.map(n => n.id!));

            for (const id of nodeIds) {
                const outgoing = this.getOutgoingEdges(id);
                for (const e of outgoing) {
                    if (nodeIds.has(e.to_id)) {
                        edgesToExport.push(e);
                    }
                }
            }
        } else {
            // Limited full export of the first few files and their contents
            const allFiles = this.nodeRepo.searchSymbols('', 10).filter(n => n.symbol_type === 'file');
            const nodeIds = new Set<number>();
            
            for (const file of allFiles) {
                const results = this.traverse(file.id!, 'BFS', { maxDepth: 1 });
                results.forEach(r => {
                    nodesToExport.push(r.node);
                    nodeIds.add(r.node.id!);
                });
            }

            for (const id of nodeIds) {
                const outgoing = this.getOutgoingEdges(id);
                for (const e of outgoing) {
                    if (nodeIds.has(e.to_id)) {
                        edgesToExport.push(e);
                    }
                }
            }
        }

        let mermaid = 'graph TD\n';
        
        // Add styling definitions
        mermaid += '  classDef file fill:#fff,stroke:#333,stroke-width:1px,stroke-dasharray: 5 5\n';
        mermaid += '  classDef class fill:#f9f,stroke:#333,stroke-width:2px\n';
        mermaid += '  classDef interface fill:#9ff,stroke:#333,stroke-width:2px\n';
        mermaid += '  classDef method fill:#bbf,stroke:#333,stroke-width:1px\n';
        mermaid += '  classDef function fill:#dfd,stroke:#333,stroke-width:1px\n';
        mermaid += '  classDef remote fill:#ffd,stroke:#f66,stroke-width:2px,stroke-dasharray: 5 5\n';

        // Dedup nodes
        const uniqueNodes = Array.from(new Map(nodesToExport.map(n => [n.id, n])).values());
        
        for (const node of uniqueNodes) {
            const shortName = node.qualified_name.split(/[#.\/]/).pop();
            let label = `${node.symbol_type}: ${shortName}`;
            
            let cssClass = node.symbol_type === 'file' ? ':::file' : 
                           node.symbol_type === 'class' ? ':::class' :
                           node.symbol_type === 'interface' ? ':::interface' :
                           node.symbol_type === 'method' ? ':::method' :
                           node.symbol_type === 'function' ? ':::function' : '';

            if (node.remote_project_path) {
                const projectName = node.qualified_name.split(':')[1];
                label = `[${projectName}] ${label}`;
                cssClass = ':::remote';
            }
            
            mermaid += `  N${node.id}["${label}"]${cssClass}\n`;
        }
        for (const edge of edgesToExport) {
            mermaid += `  N${edge.from_id} -- ${edge.edge_type} --> N${edge.to_id}\n`;
        }
        return mermaid;
    }

    private bfs(
        startId: number,
        direction: 'outgoing' | 'incoming',
        edgeType: EdgeType | undefined,
        maxDepth: number,
        results: TraversalResult[],
        visited: Set<number>
    ): void {
        const queue: { id: number, depth: number, path: TraversalPathStep[] }[] = [
            { id: startId, depth: 0, path: [{ nodeId: startId }] }
        ];
        visited.add(startId);

        while (queue.length > 0) {
            const { id, depth, path } = queue.shift()!;

            const node = this.getNodeById(id);
            if (node) {
                results.push({ node, distance: depth, path });
            }

            if (depth >= maxDepth) continue;

            const edges = direction === 'outgoing'
                ? this.edgeRepo.getOutgoingEdges(id, edgeType)
                : this.edgeRepo.getIncomingEdges(id, edgeType);

            for (const edge of edges) {
                const nextId = direction === 'outgoing' ? edge.to_id : edge.from_id;
                if (!visited.has(nextId)) {
                    visited.add(nextId);
                    queue.push({
                        id: nextId,
                        depth: depth + 1,
                        path: [...path, { nodeId: nextId, edge }]
                    });
                }
            }
        }
    }

    private dfs(
        currentId: number,
        depth: number,
        path: TraversalPathStep[],
        direction: 'outgoing' | 'incoming',
        edgeType: EdgeType | undefined,
        maxDepth: number,
        results: TraversalResult[],
        visited: Set<number>
    ): void {
        if (visited.has(currentId) || depth > maxDepth) return;

        visited.add(currentId);
        const node = this.getNodeById(currentId);
        // Path is already built by the caller or initial call
        const currentPath = path.length === 0 ? [{ nodeId: currentId }] : path;

        if (node) {
            results.push({ node, distance: depth, path: currentPath });
        }

        if (depth >= maxDepth) return;

        const edges = direction === 'outgoing'
            ? this.edgeRepo.getOutgoingEdges(currentId, edgeType)
            : this.edgeRepo.getIncomingEdges(currentId, edgeType);

        for (const edge of edges) {
            const nextId = direction === 'outgoing' ? edge.to_id : edge.from_id;
            const nextPath = [...currentPath, { nodeId: nextId, edge }];
            this.dfs(nextId, depth + 1, nextPath, direction, edgeType, maxDepth, results, visited);
        }
    }
}

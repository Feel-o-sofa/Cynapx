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
 * LRUCache is a simple Least Recently Used cache backed by a Map.
 * Map maintains insertion order; delete + re-insert on access gives O(1) LRU semantics.
 */
class LRUCache<K, V> {
    private readonly _map = new Map<K, V>();
    private readonly _max: number;

    constructor(max: number) {
        this._max = max;
    }

    get(key: K): V | undefined {
        if (!this._map.has(key)) return undefined;
        // Move to tail (most-recently-used position)
        const value = this._map.get(key)!;
        this._map.delete(key);
        this._map.set(key, value);
        return value;
    }

    set(key: K, value: V): void {
        if (this._map.has(key)) {
            this._map.delete(key);
        }
        this._map.set(key, value);
        // Evict least-recently-used entry (head of Map iteration)
        if (this._map.size > this._max) {
            const oldest = this._map.keys().next().value as K;
            this._map.delete(oldest);
        }
    }

    has(key: K): boolean {
        return this._map.has(key);
    }

    delete(key: K): boolean {
        return this._map.delete(key);
    }

    clear(): void {
        this._map.clear();
    }

    get size(): number {
        return this._map.size;
    }
}

/**
 * GraphEngine implements the logic for graph traversal and symbol resolution.
 */
export class GraphEngine {
    private nodeCache = new LRUCache<number, CodeNode>(10_000);
    private qnameCache = new LRUCache<string, CodeNode>(10_000);
    private impactCache = new LRUCache<string, { timestamp: number, results: TraversalResult[] }>(5_000);

    constructor(
        public nodeRepo: NodeRepository,
        private edgeRepo: EdgeRepository
    ) { }

    public invalidateCache(): void {
        this.impactCache = new LRUCache<string, { timestamp: number, results: TraversalResult[] }>(5_000);
        this.nodeCache = new LRUCache<number, CodeNode>(10_000);
        this.qnameCache = new LRUCache<string, CodeNode>(10_000);
    }

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
     * Executes the Label Propagation Algorithm (LPA) for community detection.
     * O(V + E) per iteration, typically converges in <20 iterations.
     * Groups symbols into logical clusters and saves results to DB.
     */
    public async performClustering(): Promise<{ clusterCount: number, nodesClustered: number }> {
        const nodes = this.nodeRepo.getAllNodes();
        const edges = this.edgeRepo.getAllEdges();
        if (nodes.length === 0) return { clusterCount: 0, nodesClustered: 0 };

        // Build adjacency (undirected) — O(E)
        const adjacency = new Map<number, number[]>();
        for (const n of nodes) adjacency.set(n.id!, []);
        for (const e of edges) {
            adjacency.get(e.from_id)?.push(e.to_id);
            adjacency.get(e.to_id)?.push(e.from_id);
        }

        const nodeMap = new Map(nodes.map(n => [n.id!, n]));

        // Initialize: each node gets its own label
        const label = new Map<number, number>();
        for (const n of nodes) label.set(n.id!, n.id!);

        // Label propagation — O(V + E) per iteration
        const MAX_ITER = 20;
        for (let iter = 0; iter < MAX_ITER; iter++) {
            let changed = false;

            // Shuffle node order each iteration to avoid label propagation bias.
            // Note: non-deterministic by design — results vary between runs, which
            // is acceptable for exploratory clustering. Use a seeded PRNG if
            // reproducibility is required.
            const order = [...nodes].sort(() => Math.random() - 0.5);

            for (const node of order) {
                const neighbors = adjacency.get(node.id!) || [];
                if (neighbors.length === 0) continue;

                // Count neighbor label frequencies
                const freq = new Map<number, number>();
                for (const nbId of neighbors) {
                    const lbl = label.get(nbId)!;
                    freq.set(lbl, (freq.get(lbl) || 0) + 1);
                }

                // File-proximity bonus: neighbors in same file get +0.5 count
                const currentNode = nodeMap.get(node.id!);
                for (const nbId of neighbors) {
                    const nb = nodeMap.get(nbId);
                    if (currentNode && nb && currentNode.file_path === nb.file_path) {
                        const lbl = label.get(nbId)!;
                        freq.set(lbl, (freq.get(lbl) || 0) + 0.5);
                    }
                }

                // Pick most frequent label (tie-break: keep current)
                let best = label.get(node.id!)!;
                let bestCount = freq.get(best) || 0;
                for (const [lbl, count] of freq) {
                    if (count > bestCount) { best = lbl; bestCount = count; }
                }

                if (best !== label.get(node.id!)) {
                    label.set(node.id!, best);
                    changed = true;
                }
            }

            if (!changed) break;
        }

        // Group nodes by label
        const groups = new Map<number, number[]>();
        for (const [nodeId, lbl] of label) {
            if (!groups.has(lbl)) groups.set(lbl, []);
            groups.get(lbl)!.push(nodeId);
        }
        const clusters = [...groups.values()];

        await this.persistClusters(clusters, nodeMap);
        return { clusterCount: clusters.length, nodesClustered: nodes.length };
    }

    private async persistClusters(clusters: number[][], nodeMap: Map<number, CodeNode>): Promise<void> {
        const db = this.nodeRepo.getDb();
        db.transaction(() => {
            db.prepare('DELETE FROM logical_clusters').run();
            db.prepare('UPDATE nodes SET cluster_id = NULL').run();
        })();

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

            const avgComplexity = clusterNodes.length > 0 ? totalComplexity / clusterNodes.length : 0;
            
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
            this.dfs(startNodeId, direction, edgeType, maxDepth, results, visited);
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
            const allFiles = this.nodeRepo.getAllNodes().filter(n => n.symbol_type === 'file').slice(0, 10);
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
            const allFiles = this.nodeRepo.getAllNodes().filter(n => n.symbol_type === 'file').slice(0, 10);
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
        interface BfsEntry { id: number; depth: number; parentIndex: number; edge?: CodeEdge; }
        const entries: BfsEntry[] = [];
        const queue: number[] = []; // indices into entries

        entries.push({ id: startId, depth: 0, parentIndex: -1 });
        queue.push(0);
        visited.add(startId);

        const reconstructPath = (idx: number): TraversalPathStep[] => {
            const path: TraversalPathStep[] = [];
            while (idx >= 0) {
                path.unshift({ nodeId: entries[idx].id, edge: entries[idx].edge });
                idx = entries[idx].parentIndex;
            }
            return path;
        };

        while (queue.length > 0) {
            const entryIdx = queue.shift()!;
            const entry = entries[entryIdx];

            const node = this.getNodeById(entry.id);
            if (node) {
                results.push({ node, distance: entry.depth, path: reconstructPath(entryIdx) });
            }

            if (entry.depth >= maxDepth) continue;

            const edges = direction === 'outgoing'
                ? this.edgeRepo.getOutgoingEdges(entry.id, edgeType)
                : this.edgeRepo.getIncomingEdges(entry.id, edgeType);

            for (const edge of edges) {
                const nextId = direction === 'outgoing' ? edge.to_id : edge.from_id;
                if (!visited.has(nextId)) {
                    visited.add(nextId);
                    const newIdx = entries.length;
                    entries.push({ id: nextId, depth: entry.depth + 1, parentIndex: entryIdx, edge });
                    queue.push(newIdx);
                }
            }
        }
    }

    private dfs(
        currentId: number,
        direction: 'outgoing' | 'incoming',
        edgeType: EdgeType | undefined,
        maxDepth: number,
        results: TraversalResult[],
        visited: Set<number>
    ): void {
        // depth and path removed from signature — initialized internally
        interface DfsEntry { id: number; depth: number; parentIndex: number; edge?: CodeEdge; }
        const entries: DfsEntry[] = [];
        const stack: DfsEntry[] = [{ id: currentId, depth: 0, parentIndex: -1 }];

        const reconstructPath = (idx: number): TraversalPathStep[] => {
            const p: TraversalPathStep[] = [];
            while (idx >= 0) {
                p.unshift({ nodeId: entries[idx].id, edge: entries[idx].edge });
                idx = entries[idx].parentIndex;
            }
            return p;
        };

        while (stack.length > 0) {
            const entry = stack.pop()!;
            if (visited.has(entry.id) || entry.depth > maxDepth) continue;
            visited.add(entry.id);

            const entryIndex = entries.length;
            entries.push(entry);

            const node = this.getNodeById(entry.id);
            if (node) {
                results.push({ node, distance: entry.depth, path: reconstructPath(entryIndex) });
            }

            if (entry.depth < maxDepth) {
                const edges = direction === 'outgoing'
                    ? this.edgeRepo.getOutgoingEdges(entry.id, edgeType)
                    : this.edgeRepo.getIncomingEdges(entry.id, edgeType);

                for (const edge of edges) {
                    const nextId = direction === 'outgoing' ? edge.to_id : edge.from_id;
                    stack.push({ id: nextId, depth: entry.depth + 1, parentIndex: entryIndex, edge });
                }
            }
        }
    }
}

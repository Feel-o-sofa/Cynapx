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

    public clearCache(): void {
        this.nodeCache.clear();
        this.qnameCache.clear();
    }

    public getOutgoingEdges(nodeId: number, edgeType?: EdgeType): CodeEdge[] {
        return this.edgeRepo.getOutgoingEdges(nodeId, edgeType);
    }

    public getIncomingEdges(nodeId: number, edgeType?: EdgeType): CodeEdge[] {
        return this.edgeRepo.getIncomingEdges(nodeId, edgeType);
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
        } = {}
    ): TraversalResult[] {
        const maxDepth = options.maxDepth ?? 5;
        const direction = options.direction ?? 'outgoing';
        const edgeType = options.edgeType;

        const results: TraversalResult[] = [];
        const visited = new Set<number>();

        if (strategy === 'BFS') {
            this.bfs(startNodeId, direction, edgeType, maxDepth, results, visited);
        } else {
            this.dfs(startNodeId, 0, [], direction, edgeType, maxDepth, results, visited);
        }

        return results;
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

import { NodeRepository } from '../db/node-repository';
import { EdgeRepository } from '../db/edge-repository';
import { CodeNode, CodeEdge, EdgeType } from '../types';

export type TraversalStrategy = 'DFS' | 'BFS';

export interface TraversalResult {
    node: CodeNode;
    distance: number;
    path: number[];
}

/**
 * GraphEngine implements the logic for graph traversal and symbol resolution.
 */
export class GraphEngine {
    constructor(
        public nodeRepo: NodeRepository,
        private edgeRepo: EdgeRepository
    ) { }

    public getNodeByQualifiedName(qualifiedName: string): CodeNode | null {
        return this.nodeRepo.getNodeByQualifiedName(qualifiedName);
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
        const queue: { id: number, depth: number, path: number[] }[] = [{ id: startId, depth: 0, path: [startId] }];
        visited.add(startId);

        while (queue.length > 0) {
            const { id, depth, path } = queue.shift()!;

            const node = this.nodeRepo.getNodeById(id);
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
                    queue.push({ id: nextId, depth: depth + 1, path: [...path, nextId] });
                }
            }
        }
    }

    private dfs(
        currentId: number,
        depth: number,
        path: number[],
        direction: 'outgoing' | 'incoming',
        edgeType: EdgeType | undefined,
        maxDepth: number,
        results: TraversalResult[],
        visited: Set<number>
    ): void {
        if (visited.has(currentId) || depth > maxDepth) return;

        visited.add(currentId);
        const node = this.nodeRepo.getNodeById(currentId);
        const currentPath = [...path, currentId];

        if (node) {
            results.push({ node, distance: depth, path: currentPath });
        }

        if (depth >= maxDepth) return;

        const edges = direction === 'outgoing'
            ? this.edgeRepo.getOutgoingEdges(currentId, edgeType)
            : this.edgeRepo.getIncomingEdges(currentId, edgeType);

        for (const edge of edges) {
            const nextId = direction === 'outgoing' ? edge.to_id : edge.from_id;
            this.dfs(nextId, depth + 1, currentPath, direction, edgeType, maxDepth, results, visited);
        }
    }
}

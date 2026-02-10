import { Database } from 'better-sqlite3';
import { NodeRepository } from '../db/node-repository';
import { EdgeRepository } from '../db/edge-repository';
import { FileChangeEvent, CodeParser, DeltaGraph } from './types';

/**
 * UpdatePipeline manages the incremental update process for the knowledge graph.
 */
export class UpdatePipeline {
    constructor(
        private db: Database,
        private nodeRepo: NodeRepository,
        private edgeRepo: EdgeRepository,
        private parser: CodeParser
    ) { }

    public async processChangeEvent(event: FileChangeEvent, version: number): Promise<void> {
        const { event: type, file_path, commit } = event;

        try {
            console.log(`Processing ${type} for ${file_path} (Commit: ${commit}, Version: ${version})`);

            this.db.prepare('BEGIN').run();

            // 1. DELETE phase (for MODIFY and DELETE events)
            if (type === 'DELETE' || type === 'MODIFY') {
                this.handleDelete(file_path);
            }

            // 2. ADD phase (for ADD and MODIFY events)
            if (type === 'ADD' || type === 'MODIFY') {
                await this.handleAdd(file_path, commit, version);
            }

            this.db.prepare('COMMIT').run();
            console.log(`Successfully processed ${file_path}`);
        } catch (error) {
            if (this.db.inTransaction) {
                this.db.prepare('ROLLBACK').run();
            }
            console.error(`Failed to process change event for ${file_path}:`, error);
            throw error;
        }
    }

    /**
     * Removes all nodes and edges associated with a file.
     */
    private handleDelete(filePath: string): void {
        // Get all nodes defined in this file
        const nodes = this.nodeRepo.getNodesByFilePath(filePath);

        for (const node of nodes) {
            if (node.id) {
                // FK constraints ON DELETE CASCADE will handle edges if set up, 
                // but we explicitly clean up if needed according to rules.
                this.edgeRepo.deleteEdgesByNodeId(node.id);
            }
        }

        // Delete the nodes themselves
        this.nodeRepo.deleteNodesByFilePath(filePath);
    }

    /**
     * Parses a file and adds its nodes and edges to the database.
     */
    private async handleAdd(filePath: string, commit: string, version: number): Promise<void> {
        if (!this.parser.supports(filePath)) {
            console.warn(`No parser supported for file: ${filePath}`);
            return;
        }

        // Parse the file to get definitions and relations
        const delta: DeltaGraph = await this.parser.parse(filePath, commit, version);

        // Map to keep track of newly created internal IDs for edge creation
        const qualifiedNameToId = new Map<string, number>();

        // 1. Insert Nodes
        for (const node of delta.nodes) {
            // Check for existing symbol (though handleDelete should have cleared it if it was in the same file)
            // If it exists in another file, it's a conflict based on qualified_name UNIQUE constraint.
            const nodeId = this.nodeRepo.createNode(node);
            qualifiedNameToId.set(node.qualified_name, nodeId);
        }

        // 2. Insert Edges
        for (const edge of delta.edges) {
            // Resolve IDs for the edge
            // Internal nodes are resolved via our map
            // External nodes must be resolved via the database

            const fromId = this.resolveNodeId(edge, 'from', qualifiedNameToId);
            const toId = this.resolveNodeId(edge, 'to', qualifiedNameToId);

            if (fromId !== undefined && toId !== undefined) {
                this.edgeRepo.createEdge({
                    ...edge,
                    from_id: fromId,
                    to_id: toId
                });
            }
        }

        // 3. Update Fan-in / Fan-out for all involved nodes
        const allInvolvedIds = new Set<number>([...qualifiedNameToId.values()]);
        // Also include nodes that were targets of new edges
        for (const edge of delta.edges) {
            const toId = this.resolveNodeId(edge, 'to', qualifiedNameToId);
            if (toId) allInvolvedIds.add(toId);
        }

        for (const id of allInvolvedIds) {
            const fanIn = this.edgeRepo.getIncomingEdges(id, 'calls').length;
            const fanOut = this.edgeRepo.getOutgoingEdges(id, 'calls').length;
            this.nodeRepo.updateMetrics(id, { fan_in: fanIn, fan_out: fanOut });
        }
    }

    /**
     * Resolves a node ID from temporary map or database.
     */
    private resolveNodeId(
        edge: any,
        side: 'from' | 'to',
        internalMap: Map<string, number>
    ): number | undefined {
        const qname = side === 'from' ? edge.from_qname : edge.to_qname;
        const fileHint = side === 'to' ? edge.target_file_hint : undefined;

        // Check internal definitions first
        if (internalMap.has(qname)) {
            return internalMap.get(qname);
        }

        // Check database with file hint if available
        if (fileHint) {
            const nodes = this.nodeRepo.getNodesByFilePath(fileHint);
            const targetNode = nodes.find(n => n.qualified_name === qname || n.qualified_name.endsWith(`.${qname}`));
            if (targetNode) return targetNode.id;
        }

        // Fallback to name-only lookup
        const existingNode = this.nodeRepo.getNodeByQualifiedName(qname);
        return existingNode?.id;
    }
}

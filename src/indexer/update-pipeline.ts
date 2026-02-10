import { Database } from 'better-sqlite3';
import { NodeRepository } from '../db/node-repository';
import { EdgeRepository } from '../db/edge-repository';
import { MetadataRepository } from '../db/metadata-repository';
import { GitService } from './git-service';
import { FileChangeEvent, CodeParser, DeltaGraph, ChangeType } from './types';
import { WorkerPool } from './worker-pool';

/**
 * UpdatePipeline manages the incremental update process for the knowledge graph.
 */
export class UpdatePipeline {
    constructor(
        private db: Database,
        private nodeRepo: NodeRepository,
        private edgeRepo: EdgeRepository,
        private parser: CodeParser,
        private metadataRepo?: MetadataRepository,
        private gitService?: GitService,
        private workerPool?: WorkerPool
    ) { }

    private writeLock: Promise<void> = Promise.resolve();

    public async processChangeEvent(event: FileChangeEvent, version: number): Promise<void> {
        const { event: type, file_path, commit } = event;

        try {
            console.log(`Processing ${type} for ${file_path} (Commit: ${commit}, Version: ${version})`);

            let delta: DeltaGraph;
            if (type === 'ADD' || type === 'MODIFY') {
                if (this.workerPool) {
                    delta = await this.workerPool.runTask({ filePath: file_path, commit, version });
                } else {
                    delta = await this.parser.parse(file_path, commit, version);
                }
                await this.applyDelta(file_path, delta, type);
            } else if (type === 'DELETE') {
                await this.applyDeleteSerial(file_path);
            }

            // Update last_indexed_commit if it was a real commit (not 'watcher-change')
            if (this.metadataRepo && this.gitService && commit !== 'watcher-change' && commit !== 'deleted' && commit !== 'unknown') {
                this.metadataRepo.setLastIndexedCommit(commit);
            }

            console.log(`Successfully processed ${file_path}`);
        } catch (error) {
            console.error(`Failed to process change event for ${file_path}:`, error);
            throw error;
        }
    }

    public async processBatch(events: FileChangeEvent[], version: number): Promise<void> {
        console.log(`Processing batch of ${events.length} files...`);
        
        // 1. Parallel Parse (Skip for DELETE)
        const results = await Promise.all(events.map(async (event) => {
            if (event.event === 'DELETE') {
                return { event, delta: { nodes: [], edges: [] }, status: 'success' as const };
            }

            try {
                let delta: DeltaGraph;
                if (this.workerPool) {
                    delta = await this.workerPool.runTask({ filePath: event.file_path, commit: event.commit, version });
                } else {
                    delta = await this.parser.parse(event.file_path, event.commit, version);
                }
                return { event, delta, status: 'success' as const };
            } catch (error) {
                console.error(`Failed to parse ${event.file_path}:`, error);
                return { event, status: 'error' as const };
            }
        }));

        // 2. Serial Commit in a single large transaction
        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });

        await previousLock;

        try {
            this.db.prepare('BEGIN').run();
            
            for (const res of results) {
                if (res.status === 'success') {
                    // Similar to applyDelta but inside this transaction
                    if (res.event.event === 'ADD' || res.event.event === 'MODIFY' || res.event.event === 'DELETE') {
                        this.handleDelete(res.event.file_path);
                    }
                    if (res.event.event === 'ADD' || res.event.event === 'MODIFY') {
                        await this.writeDeltaToDb(res.event.file_path, res.delta);
                    }
                    console.log(`Successfully processed ${res.event.file_path}`);
                }
            }

            this.db.prepare('COMMIT').run();

            // After successful batch, if we have gitService, update to HEAD
            if (this.metadataRepo && this.gitService) {
                const head = await this.gitService.getCurrentHead();
                if (head !== 'unknown') {
                    this.metadataRepo.setLastIndexedCommit(head);
                }
            }

            console.log(`Batch processing complete.`);
        } catch (error) {
            if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
            console.error(`Failed to commit batch:`, error);
            throw error;
        } finally {
            resolveLock!();
        }
    }

    /**
     * Synchronizes the database with the current Git HEAD.
     */
    public async syncWithGit(projectPath: string): Promise<void> {
        if (!this.metadataRepo || !this.gitService) {
            console.warn('MetadataRepo or GitService not provided. Skipping Git sync.');
            return;
        }

        const lastCommit = this.metadataRepo.getLastIndexedCommit();
        const currentHead = await this.gitService.getCurrentHead();
        const version = Date.now();

        if (!lastCommit) {
            console.log('No previous index found. Sync skipped (initial scan should handle this).');
            return;
        }

        if (lastCommit === currentHead) {
            console.log(`Index is already up-to-date with Git HEAD (${currentHead.substring(0, 7)}).`);
            return;
        }

        console.log(`Index out of sync. (DB: ${lastCommit.substring(0, 7)}, HEAD: ${currentHead.substring(0, 7)})`);
        console.log('Starting Git-based Catch-up Sync...');

        const diffs = await this.gitService.getDiffFiles(lastCommit, currentHead);
        console.log(`Detected ${diffs.length} changed files since last session.`);

        if (diffs.length === 0) {
            this.metadataRepo.setLastIndexedCommit(currentHead);
            return;
        }

        const events = await Promise.all(diffs.map(async (d) => {
            const fullPath = require('path').resolve(projectPath, d.file);
            const commit = d.status === 'DELETE' ? 'deleted' : await this.gitService!.getLatestCommit(fullPath);
            return {
                event: d.status as 'ADD' | 'MODIFY' | 'DELETE',
                file_path: fullPath,
                commit: commit
            };
        }));

        await this.processBatch(events, version);
        this.metadataRepo.setLastIndexedCommit(currentHead);
        console.log('Catch-up Sync Complete.');
    }

    /**
     * Internal helper to write delta to DB without its own transaction.
     */
    private async writeDeltaToDb(filePath: string, delta: DeltaGraph): Promise<void> {
        const qualifiedNameToId = new Map<string, number>();

        // 1. Insert Nodes
        for (const node of delta.nodes) {
            const nodeId = this.nodeRepo.createNode(node);
            qualifiedNameToId.set(node.qualified_name, nodeId);
        }

        // 2. Insert Edges
        for (const edge of delta.edges) {
            const fromId = this.resolveNodeId(edge, 'from', qualifiedNameToId);
            const toId = this.resolveNodeId(edge, 'to', qualifiedNameToId);

            if (fromId !== undefined && toId !== undefined) {
                this.edgeRepo.createEdge({ ...edge, from_id: fromId, to_id: toId });
            }
        }

        // 3. Update Metrics
        const allInvolvedIds = new Set<number>([...qualifiedNameToId.values()]);
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
     * Applies a pre-parsed DeltaGraph to the database sequentially.
     */
    public async applyDelta(filePath: string, delta: DeltaGraph, type: ChangeType): Promise<void> {
        // Serial Committer: Queue the database write
        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });

        await previousLock;

        try {
            this.db.prepare('BEGIN').run();
            // 1. DELETE old info if MODIFY
            if (type === 'MODIFY') {
                this.handleDelete(filePath);
            }

            // 2. ADD new info
            const qualifiedNameToId = new Map<string, number>();

            // 2.1 Insert Nodes
            for (const node of delta.nodes) {
                const nodeId = this.nodeRepo.createNode(node);
                qualifiedNameToId.set(node.qualified_name, nodeId);
            }

            // 2.2 Insert Edges
            for (const edge of delta.edges) {
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

            // 2.3 Update Metrics
            const allInvolvedIds = new Set<number>([...qualifiedNameToId.values()]);
            for (const edge of delta.edges) {
                const toId = this.resolveNodeId(edge, 'to', qualifiedNameToId);
                if (toId) allInvolvedIds.add(toId);
            }

            for (const id of allInvolvedIds) {
                const fanIn = this.edgeRepo.getIncomingEdges(id, 'calls').length;
                const fanOut = this.edgeRepo.getOutgoingEdges(id, 'calls').length;
                this.nodeRepo.updateMetrics(id, { fan_in: fanIn, fan_out: fanOut });
            }

            this.db.prepare('COMMIT').run();
        } catch (e) {
            if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
            throw e;
        } finally {
            resolveLock!();
        }
    }

    private async applyDeleteSerial(filePath: string): Promise<void> {
        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });

        await previousLock;
        try {
            this.db.prepare('BEGIN').run();
            this.handleDelete(filePath);
            this.db.prepare('COMMIT').run();
        } finally {
            resolveLock!();
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

        // Fallback to name-only lookup (Exact Match)
        const existingNode = this.nodeRepo.getNodeByQualifiedName(qname);
        if (existingNode) return existingNode.id;

        // Heuristic Suffix Match
        if (side === 'to' && !qname.includes('#') && !qname.includes('/')) {
            const candidates = this.nodeRepo.findNodesBySymbolName(qname);
            if (candidates.length > 0) {
                return candidates[0].id;
            }
        }

        return undefined;
    }
}
/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import SQLiteDatabase from 'better-sqlite3';
import * as path from 'path';
import { NodeRepository } from '../db/node-repository';
import { EdgeRepository } from '../db/edge-repository';
import { MetadataRepository } from '../db/metadata-repository';
import { GitService } from './git-service';
import { FileChangeEvent, CodeParser, DeltaGraph, ChangeType } from './types';
import { WorkerPool } from './worker-pool';
import { toCanonical } from '../utils/paths';
import { CrossProjectResolver } from './cross-project-resolver';
import { StructuralTagger } from './structural-tagger';
import { EmbeddingManager } from './embedding-manager';
import { CodeNode } from '../types';
import { GraphEngine } from '../graph/graph-engine';
import { FullScanStrategy, IncrementalSyncStrategy } from './sync-strategies';

/**
 * UpdatePipeline manages the incremental update process for the knowledge graph.
 */
export class UpdatePipeline {
    private embeddingManager: EmbeddingManager;

    constructor(
        private db: SQLiteDatabase.Database,
        private nodeRepo: NodeRepository,
        private edgeRepo: EdgeRepository,
        private parser: CodeParser,
        private metadataRepo?: MetadataRepository,
        private gitService?: GitService,
        private workerPool?: WorkerPool,
        private projectPath?: string,
        private graphEngine?: GraphEngine
    ) {
        this.embeddingManager = new EmbeddingManager(this.db, this.nodeRepo);
        if (this.projectPath) {
            this.crossProjectResolver = new CrossProjectResolver(this.nodeRepo, this.projectPath);
        }
    }

    private writeLock: Promise<void> = Promise.resolve();
    private crossProjectResolver?: CrossProjectResolver;

    public get embeddingsAvailable(): boolean {
        return this.embeddingManager.isAvailable;
    }

    public async reTagAllNodes(): Promise<void> {
        // Acquire write lock before starting the transaction so concurrent
        // processBatch() calls cannot interleave with our multi-pass propagation.
        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;

        try {
            // A-4: dirty-set worklist propagation. Wrap baseline tagging +
            // propagation + persist in a single atomic transaction.
            // better-sqlite3 is fully synchronous, so no await / setImmediate
            // is needed (or permitted) inside the transaction body.
            const txn = this.db.transaction(() => {
                const nodes = this.nodeRepo.getAllNodes();

                // Pass 0: build node map with baseline tags (full run seeds
                // every node with its recomputed structural tags).
                const nodeMap = new Map<number, { node: CodeNode, tags: string[] }>();
                for (const node of nodes) {
                    if (node.id) {
                        const baselineTags = StructuralTagger.tagNode(node);
                        nodeMap.set(node.id, { node, tags: baselineTags });
                    }
                }

                // Build the propagation adjacency once with a single edge scan
                // (previously: one getOutgoingEdges() query per node per pass).
                //   parentsOf[child]   → nodes the child inherits / implements from
                //   childrenOf[parent] → dependents to re-enqueue when parent tags change
                const parentsOf = new Map<number, number[]>();
                const childrenOf = new Map<number, number[]>();
                for (const edge of this.edgeRepo.getEdgesByTypes(['inherits', 'implements'])) {
                    if (!nodeMap.has(edge.from_id) || !nodeMap.has(edge.to_id)) continue;
                    let parents = parentsOf.get(edge.from_id);
                    if (!parents) { parents = []; parentsOf.set(edge.from_id, parents); }
                    parents.push(edge.to_id);
                    let children = childrenOf.get(edge.to_id);
                    if (!children) { children = []; childrenOf.set(edge.to_id, children); }
                    children.push(edge.from_id);
                }

                // Dirty-set worklist: seed with every node that has at least one
                // parent — only those can gain tags via propagation. When a node's
                // tags change, re-enqueue only its direct children (the nodes whose
                // merged tags depend on it) instead of rescanning the whole graph.
                const queue: number[] = Array.from(parentsOf.keys());
                const inQueue = new Set<number>(queue);
                let head = 0; // index-based FIFO — avoids O(n) Array.shift()
                // Safety bound against pathological merge oscillation; mirrors the
                // old MAX_PASSES=5 cap at worklist granularity.
                const maxIterations = Math.max(nodeMap.size, 1) * 5;
                let iterations = 0;
                while (head < queue.length) {
                    if (++iterations > maxIterations) {
                        console.error(`[UpdatePipeline] reTagAllNodes: worklist exceeded safety bound (${maxIterations}); stopping propagation early.`);
                        break;
                    }
                    const id = queue[head++];
                    inQueue.delete(id);
                    const data = nodeMap.get(id)!;

                    let merged = data.tags;
                    for (const parentId of parentsOf.get(id)!) {
                        const parentData = nodeMap.get(parentId);
                        if (parentData && parentData.tags.length > 0) {
                            merged = StructuralTagger.mergeRoles(merged, parentData.tags);
                        }
                    }

                    if (!UpdatePipeline.sameTagSet(merged, data.tags)) {
                        data.tags = merged;
                        for (const childId of childrenOf.get(id) ?? []) {
                            if (!inQueue.has(childId)) {
                                inQueue.add(childId);
                                queue.push(childId);
                            }
                        }
                    }
                }

                // Final: persist only nodes whose computed tags actually differ
                // from what is stored. M2: replaceTags() keeps the node_tags
                // mirror table in sync with nodes.tags (we're already inside
                // one transaction here).
                for (const [id, data] of nodeMap.entries()) {
                    if (!UpdatePipeline.sameTagSet(data.tags, data.node.tags ?? [])) {
                        this.nodeRepo.replaceTags(id, data.tags);
                    }
                }
            });
            txn();
        } finally {
            resolveLock!();
        }
    }

    /** Order-insensitive tag-set equality (A-4 dirty check). */
    private static sameTagSet(a: string[], b: string[]): boolean {
        const setA = new Set(a);
        const setB = new Set(b);
        if (setA.size !== setB.size) return false;
        for (const t of setA) {
            if (!setB.has(t)) return false;
        }
        return true;
    }

    public async mapHistoryToProject(): Promise<void> {
        if (!this.gitService) return;
        const filePaths = this.nodeRepo.getAllFilePaths();
        if (filePaths.length === 0) return;

        console.error(`[UpdatePipeline] Fetching git history for ${filePaths.length} files...`);

        // Parallel fetch in chunks of 20 to avoid spawning too many git processes
        const CHUNK_SIZE = 20;
        const allHistory: Array<{ filePath: string; history: any[] }> = [];

        for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
            const chunk = filePaths.slice(i, i + CHUNK_SIZE);
            const results = await Promise.all(
                chunk.map(fp =>
                    this.gitService!.getHistoryForFile(fp)
                        .then(history => ({ filePath: fp, history }))
                        .catch(() => ({ filePath: fp, history: [] }))
                )
            );
            allHistory.push(...results);
        }

        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;

        try {
            this.db.transaction(() => {
                for (const { filePath, history } of allHistory) {
                    if (history && history.length > 0) {
                        const historyJson = JSON.stringify(history);
                        this.db.prepare('UPDATE nodes SET history = ? WHERE file_path = ?').run(historyJson, filePath);
                    }
                }
            })();
        } finally {
            resolveLock!();
        }

        console.error(`[UpdatePipeline] History backfill complete.`);
    }

    public async processChangeEvent(event: FileChangeEvent, version: number): Promise<void> {
        const { event: type, file_path, commit } = event;

        try {
            console.error(`Processing ${type} for ${file_path}`);

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

            if (this.metadataRepo && this.gitService && commit !== 'watcher-change' && commit !== 'deleted') {
                this.metadataRepo.setLastIndexedCommit(commit);
            }
        } catch (error) {
            console.error(`Failed to process ${file_path}:`, error);
            throw error;
        }
    }

    public async processBatch(events: FileChangeEvent[], version: number, targetCommit?: string): Promise<void> {
        console.error(`Processing batch of ${events.length} files...`);

        type BatchResult =
            | { event: FileChangeEvent; delta: DeltaGraph; status: 'success' }
            | { event: FileChangeEvent; status: 'error'; error: string };

        // Chunk parse tasks to avoid overwhelming the WorkerPool's queue.
        // Use the pool's maxQueueSize as the chunk size, capped at 100 to avoid excessive memory usage.
        const CHUNK_SIZE = Math.min(this.workerPool?.maxQueueSize ?? 100, 100);
        const allResults: BatchResult[] = [];

        for (let i = 0; i < events.length; i += CHUNK_SIZE) {
            const chunk = events.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(chunk.map(async (event): Promise<BatchResult> => {
                if (event.event === 'DELETE') return { event, delta: { nodes: [], edges: [] }, status: 'success' as const };
                try {
                    const delta = this.workerPool
                        ? await this.workerPool.runTask({ filePath: event.file_path, commit: event.commit, version })
                        : await this.parser.parse(event.file_path, event.commit, version);
                    return { event, delta, status: 'success' as const };
                } catch (error) {
                    console.error(`Failed to parse ${event.file_path}:`, error);
                    return { event, status: 'error' as const, error: (error as Error).message ?? String(error) };
                }
            }));
            allResults.push(...chunkResults);
        }

        const results = allResults;

        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;

        const symbolCache = new Map<string, number>();
        // O-3: keep remote DB connections open for the duration of this batch
        // instead of opening/closing one per cross-project symbol resolution.
        this.crossProjectResolver?.beginBatch();

        try {
            this.db.prepare('BEGIN').run();
            
            // Pass 1: Definitions
            for (const res of results) {
                if (res.status === 'success') {
                    // Delete edges for nodes being removed, then delete the nodes
                    const nodeIds = this.nodeRepo.getNodeIdsByFilePath(res.event.file_path);
                    for (const id of nodeIds) {
                        this.edgeRepo.deleteEdgesByNodeId(id);
                    }
                    this.nodeRepo.deleteNodesByFilePath(res.event.file_path);
                    if (res.event.event !== 'DELETE') {
                        const history = this.gitService ? await this.gitService.getHistoryForFile(res.event.file_path) : undefined;
                        for (const node of res.delta.nodes) {
                            node.tags = StructuralTagger.tagNode(node);
                            if (history) node.history = history;
                            const nodeId = this.nodeRepo.createNode(node);
                            symbolCache.set(toCanonical(node.qualified_name), nodeId);
                        }
                    }
                }
            }

            // Pass 2: Relations
            for (const res of results) {
                if (res.status === 'success' && res.event.event !== 'DELETE') {
                    for (const edge of res.delta.edges) {
                        const fromId = this.resolveNodeId(edge, 'from', symbolCache);
                        const toId = this.resolveNodeId(edge, 'to', symbolCache);

                        if (fromId !== undefined && toId !== undefined) {
                            this.edgeRepo.createEdge({ ...edge, from_id: fromId, to_id: toId });
                        }
                    }
                }
            }

            // Recompute fan_in / fan_out for all nodes based on actual edge counts
            this.recomputeFanMetrics();

            this.db.prepare('COMMIT').run();
            this.graphEngine?.invalidateCache();

            // H-7: only advance the watermark once the transaction has committed
            // successfully, and only if every file in the batch was processed.
            // Failed files are left out of the new watermark so the next
            // syncWithGit() retries them via the same diff range.
            const failedFiles = results.filter((r): r is Extract<BatchResult, { status: 'error' }> => r.status === 'error');
            if (targetCommit && this.metadataRepo) {
                if (failedFiles.length === 0) {
                    this.metadataRepo.setLastIndexedCommit(targetCommit);
                } else {
                    console.error(`[UpdatePipeline] Skipping lastIndexedCommit advance to ${targetCommit}: ${failedFiles.length} file(s) failed and will be retried — ${failedFiles.map(f => f.event.file_path).join(', ')}`);
                }
            }

            // Trigger embedding update in background
            this.embeddingManager.refreshAll().catch(err => {
                console.error(`[UpdatePipeline] Background embedding refresh failed: ${err}`);
            });
        } catch (error) {
            if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
            throw error;
        } finally {
            this.crossProjectResolver?.endBatch();
            resolveLock!();
        }
    }

    public async applyDelta(filePath: string, delta: DeltaGraph, type: ChangeType): Promise<void> {
        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;

        try {
            this.db.prepare('BEGIN').run();
            if (type === 'MODIFY') {
                // Delete edges for nodes being removed, then delete the nodes
                const nodeIds = this.nodeRepo.getNodeIdsByFilePath(filePath);
                for (const id of nodeIds) {
                    this.edgeRepo.deleteEdgesByNodeId(id);
                }
                this.nodeRepo.deleteNodesByFilePath(filePath);
            }

            const history = this.gitService ? await this.gitService.getHistoryForFile(filePath) : undefined;
            const symbolCache = new Map<string, number>();
            for (const node of delta.nodes) {
                node.tags = StructuralTagger.tagNode(node);
                if (history) node.history = history;
                const nodeId = this.nodeRepo.createNode(node);
                symbolCache.set(toCanonical(node.qualified_name), nodeId);
            }

            for (const edge of delta.edges) {
                const fromId = this.resolveNodeId(edge, 'from', symbolCache);
                const toId = this.resolveNodeId(edge, 'to', symbolCache);
                if (fromId !== undefined && toId !== undefined) {
                    this.edgeRepo.createEdge({ ...edge, from_id: fromId, to_id: toId });
                }
            }

            // Recompute fan_in / fan_out for all nodes based on actual edge counts
            this.recomputeFanMetrics();

            this.db.prepare('COMMIT').run();
            this.graphEngine?.invalidateCache();

            // Trigger embedding update in background
            this.embeddingManager.refreshAll().catch(err => {
                console.error(`[UpdatePipeline] Background embedding refresh failed: ${err}`);
            });
        } catch (e) {
            if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
            throw e;
        } finally {
            resolveLock!();
        }
    }

    public async applyDeleteSerial(filePath: string): Promise<void> {
        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;
        try {
            this.db.prepare('BEGIN').run();
            // Delete edges for nodes being removed, then delete the nodes
            const nodeIds = this.nodeRepo.getNodeIdsByFilePath(filePath);
            for (const id of nodeIds) {
                this.edgeRepo.deleteEdgesByNodeId(id);
            }
            this.nodeRepo.deleteNodesByFilePath(filePath);
            this.db.prepare('COMMIT').run();
        } catch (e) {
            if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
            throw e;
        } finally {
            resolveLock!();
        }
    }

    public async syncWithGit(projectPath: string): Promise<void> {
        if (!this.metadataRepo || !this.gitService) return;

        const lastCommit = this.metadataRepo.getLastIndexedCommit();
        const currentHead = await this.gitService.getCurrentHead();

        // Already up to date — nothing to do
        if (lastCommit && lastCommit === currentHead) return;

        const strategy = lastCommit
            ? new IncrementalSyncStrategy(this.gitService, lastCommit, currentHead)
            : new FullScanStrategy(this.gitService);

        const result = await strategy.buildEvents(projectPath);
        if (!result) return;

        await this.processBatch(result.events, Date.now(), result.head);
    }

    private recomputeFanMetrics(): void {
        this.db.prepare(
            'UPDATE nodes SET ' +
            'fan_in  = (SELECT COUNT(*) FROM edges WHERE to_id   = nodes.id AND edge_type = ?), ' +
            'fan_out = (SELECT COUNT(*) FROM edges WHERE from_id = nodes.id AND edge_type = ?)'
        ).run('calls', 'calls');
    }

    private resolveNodeId(edge: any, side: 'from' | 'to', internalMap: Map<string, number>): number | undefined {
        let qname = side === 'from' ? edge.from_qname : edge.to_qname;
        let typeHint: string | undefined;
        if (qname.includes(':')) {
            const parts = qname.split(':');
            typeHint = parts[0];
            qname = parts.slice(1).join(':');
        }

        // O-2: internalMap (symbolCache) is keyed by canonical qualified names,
        // so a direct lookup is sufficient — no need to re-scan the whole map.
        const canonicalQName = toCanonical(qname);
        if (internalMap.has(canonicalQName)) return internalMap.get(canonicalQName);

        const existingNode = this.nodeRepo.getNodeByQualifiedName(qname);
        if (existingNode) return existingNode.id;

        const candidates = this.nodeRepo.findNodesBySymbolName(qname);
        if (candidates.length > 0) {
            const bestMatch = typeHint 
                ? candidates.find(c => c.symbol_type === typeHint) || candidates[0]
                : candidates[0];
            return bestMatch.id;
        }

        // Boundaryless Edge Discovery (Task 31)
        if (side === 'to' && this.crossProjectResolver) {
            const result = this.crossProjectResolver.resolve(qname, canonicalQName);
            if (result !== undefined) return result;
        }

        return undefined;
    }
}

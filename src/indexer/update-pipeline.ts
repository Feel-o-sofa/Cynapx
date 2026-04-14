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

    public async reTagAllNodes(): Promise<void> {
        // Acquire write lock before starting the transaction so concurrent
        // processBatch() calls cannot interleave with our multi-pass propagation.
        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;

        try {
            // Wrap the entire 5-pass propagation + persist in a single atomic
            // transaction.  better-sqlite3 is fully synchronous, so no await /
            // setImmediate is needed (or permitted) inside the transaction body.
            const txn = this.db.transaction(() => {
                const nodes = this.nodeRepo.getAllNodes();

                // Pass 0: build node map with baseline tags
                const nodeMap = new Map<number, { node: CodeNode, tags: string[] }>();
                for (const node of nodes) {
                    if (node.id) {
                        const baselineTags = StructuralTagger.tagNode(node);
                        nodeMap.set(node.id, { node, tags: baselineTags });
                    }
                }

                // Passes 1-5: propagate tags through inheritance / implements edges
                const MAX_PASSES = 5;
                for (let i = 0; i < MAX_PASSES; i++) {
                    let changed = false;
                    for (const [id, data] of nodeMap.entries()) {
                        const outgoing = this.edgeRepo.getOutgoingEdges(id).filter(
                            e => e.edge_type === 'inherits' || e.edge_type === 'implements'
                        );

                        for (const edge of outgoing) {
                            const parentData = nodeMap.get(edge.to_id);
                            if (parentData && parentData.tags.length > 0) {
                                const newTags = StructuralTagger.mergeRoles(data.tags, parentData.tags);
                                if (newTags.length !== data.tags.length || !newTags.every(t => data.tags.includes(t))) {
                                    data.tags = newTags;
                                    changed = true;
                                }
                            }
                        }
                    }
                    if (!changed) break;
                }

                // Final: persist all updated tags
                const updateStmt = this.db.prepare('UPDATE nodes SET tags = ? WHERE id = ?');
                for (const [id, data] of nodeMap.entries()) {
                    updateStmt.run(JSON.stringify(data.tags), id);
                }
            });
            txn();
        } catch (e) {
            throw e;
        } finally {
            resolveLock!();
        }
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
            this.db.prepare('BEGIN').run();
            for (const { filePath, history } of allHistory) {
                if (history && history.length > 0) {
                    const historyJson = JSON.stringify(history);
                    this.db.prepare('UPDATE nodes SET history = ? WHERE file_path = ?').run(historyJson, filePath);
                }
            }
            this.db.prepare('COMMIT').run();
        } catch (e) {
            if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
            throw e;
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

    public async processBatch(events: FileChangeEvent[], version: number): Promise<void> {
        console.error(`Processing batch of ${events.length} files...`);
        
        type BatchResult =
            | { event: FileChangeEvent; delta: DeltaGraph; status: 'success' }
            | { event: FileChangeEvent; status: 'error'; error: string };

        const results = await Promise.all(events.map(async (event): Promise<BatchResult> => {
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

        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;

        const symbolCache = new Map<string, number>();

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
            this.db.prepare(
                'UPDATE nodes SET ' +
                'fan_in  = (SELECT COUNT(*) FROM edges WHERE to_id   = nodes.id AND edge_type = ?), ' +
                'fan_out = (SELECT COUNT(*) FROM edges WHERE from_id = nodes.id AND edge_type = ?)'
            ).run('calls', 'calls');

            this.db.prepare('COMMIT').run();
            this.graphEngine?.invalidateCache();

            // Trigger embedding update in background
            this.embeddingManager.refreshAll().catch(err => {
                console.error(`[UpdatePipeline] Background embedding refresh failed: ${err}`);
            });
        } catch (error) {
            if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
            throw error;
        } finally {
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
            this.db.prepare(
                'UPDATE nodes SET ' +
                'fan_in  = (SELECT COUNT(*) FROM edges WHERE to_id   = nodes.id AND edge_type = ?), ' +
                'fan_out = (SELECT COUNT(*) FROM edges WHERE from_id = nodes.id AND edge_type = ?)'
            ).run('calls', 'calls');

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
        if (!lastCommit || lastCommit === currentHead) return;

        const diffs = await this.gitService.getDiffFiles(lastCommit, currentHead);
        if (diffs.length === 0) return;

        const events = await Promise.all(diffs.map(async (d) => {
            const fullPath = path.resolve(projectPath, d.file);
            const commit = d.status === 'DELETE' ? 'deleted' : await this.gitService!.getLatestCommit(fullPath);
            return { event: d.status as any, file_path: fullPath, commit };
        }));

        await this.processBatch(events, Date.now());
    }

    private resolveNodeId(edge: any, side: 'from' | 'to', internalMap: Map<string, number>): number | undefined {
        let qname = side === 'from' ? edge.from_qname : edge.to_qname;
        let typeHint: string | undefined;
        if (qname.includes(':')) {
            const parts = qname.split(':');
            typeHint = parts[0];
            qname = parts.slice(1).join(':');
        }

        const canonicalQName = toCanonical(qname);
        if (internalMap.has(canonicalQName)) return internalMap.get(canonicalQName);
        
        for (const [key, value] of internalMap.entries()) {
            if (toCanonical(key) === canonicalQName) return value;
        }

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

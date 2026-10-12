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
import { GitService, DiffFailedError } from './git-service';
import { FileChangeEvent, CodeParser, DeltaGraph, ChangeType } from './types';
import { WorkerPool } from './worker-pool';
import { toCanonical } from '../utils/paths';
import { CrossProjectResolver } from './cross-project-resolver';
import { StructuralTagger } from './structural-tagger';
import { EmbeddingManager } from './embedding-manager';
import { createEmbeddingProviderFromEnv } from './embedding-providers';
import { CodeNode } from '../types';
import { GraphEngine } from '../graph/graph-engine';
import { FullScanStrategy, IncrementalSyncStrategy } from './sync-strategies';
import { Logger } from '../utils/logger';


/** Symbol types a call can target (a class, for a constructor call). */
const CALLABLE_TYPES = new Set(['function', 'method', 'class']);
const isCallable = (node: CodeNode) => CALLABLE_TYPES.has(node.symbol_type);

/** Canonical paths of the files a parsed file imports (its depends_on targets). */
function importedFiles(delta: DeltaGraph): Set<string> {
    const files = new Set<string>();
    for (const edge of delta.edges) {
        if (edge.edge_type === 'depends_on') files.add(toCanonical(edge.to_qname));
    }
    return files;
}

/**
 * Names a qualifier may use for a file's module: its stem, or its directory
 * for a package entry file (`mod.rs`, `__init__.py`, `index.js`) and for Go,
 * where the package is the directory.
 */
function moduleNames(file: string): string[] {
    const ext = path.posix.extname(file);
    const stem = path.posix.basename(file, ext);
    const dir = path.posix.basename(path.posix.dirname(file));
    if (ext === '.go' || ['mod', '__init__', 'index'].includes(stem)) return [dir, stem];
    return [stem];
}

const log = new Logger('UpdatePipeline');
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
        this.embeddingManager = new EmbeddingManager(this.db, this.nodeRepo, createEmbeddingProviderFromEnv());
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
                        log.error(`[UpdatePipeline] reTagAllNodes: worklist exceeded safety bound (${maxIterations}); stopping propagation early.`);
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

        log.error(`[UpdatePipeline] Fetching git history for ${filePaths.length} files...`);

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

        log.error(`[UpdatePipeline] History backfill complete.`);
    }

    /**
     * H-4: Pre-fetches git history for the given file paths BEFORE any
     * transaction is opened, using the same chunked-parallel pattern as
     * mapHistoryToProject() (CHUNK_SIZE=20). Returns a Map keyed by file path.
     *
     * This is the mechanism that lets the transaction body in processBatch()
     * and applyDelta() be purely synchronous: all `await`-ing git subprocess
     * work happens here, outside BEGIN/COMMIT, so the open SQLite transaction
     * never yields the event loop (which previously allowed a background
     * embeddingManager.refreshAll() write to join the outer transaction).
     */
    private async prefetchHistories(filePaths: string[]): Promise<Map<string, any[]>> {
        const result = new Map<string, any[]>();
        if (!this.gitService || filePaths.length === 0) return result;

        // De-duplicate so the same file isn't fetched twice within one batch.
        const unique = Array.from(new Set(filePaths));
        const CHUNK_SIZE = 20;
        for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
            const chunk = unique.slice(i, i + CHUNK_SIZE);
            const fetched = await Promise.all(
                chunk.map(fp =>
                    this.gitService!.getHistoryForFile(fp)
                        .then(history => ({ filePath: fp, history }))
                        .catch(() => ({ filePath: fp, history: [] as any[] }))
                )
            );
            for (const { filePath, history } of fetched) {
                result.set(filePath, history);
            }
        }
        return result;
    }

    public async processChangeEvent(event: FileChangeEvent, version: number): Promise<void> {
        const { event: type, file_path, commit } = event;

        try {
            log.error(`Processing ${type} for ${file_path}`);

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
            log.error(`Failed to process ${file_path}:`, { detail: error });
            throw error;
        }
    }

    public async processBatch(events: FileChangeEvent[], version: number, targetCommit?: string): Promise<void> {
        log.error(`Processing batch of ${events.length} files...`);

        type BatchResult =
            | { event: FileChangeEvent; delta: DeltaGraph; status: 'success' }
            | { event: FileChangeEvent; status: 'skipped' }
            | { event: FileChangeEvent; status: 'error'; error: string };

        // Chunk parse tasks to avoid overwhelming the WorkerPool's queue.
        // Use the pool's maxQueueSize as the chunk size, capped at 100 to avoid excessive memory usage.
        const CHUNK_SIZE = Math.min(this.workerPool?.maxQueueSize ?? 100, 100);
        const allResults: BatchResult[] = [];

        for (let i = 0; i < events.length; i += CHUNK_SIZE) {
            const chunk = events.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(chunk.map(async (event): Promise<BatchResult> => {
                if (event.event === 'DELETE') return { event, delta: { nodes: [], edges: [] }, status: 'success' as const };
                // Tracked files no parser handles (LICENSE, Dockerfile, .gitignore,
                // query files, ...) are not failures. Counting them as failures
                // held lastIndexedCommit back forever, so every start re-indexed
                // the whole repository.
                if (!this.parser.supports(event.file_path)) return { event, status: 'skipped' as const };
                try {
                    const delta = this.workerPool
                        ? await this.workerPool.runTask({ filePath: event.file_path, commit: event.commit, version })
                        : await this.parser.parse(event.file_path, event.commit, version);
                    return { event, delta, status: 'success' as const };
                } catch (error) {
                    log.error(`Failed to parse ${event.file_path}:`, { detail: error });
                    return { event, status: 'error' as const, error: (error as Error).message ?? String(error) };
                }
            }));
            allResults.push(...chunkResults);
        }

        const results = allResults;
        const skipped = results.filter(r => r.status === 'skipped').length;
        if (skipped > 0) log.info(`Skipped ${skipped} file(s) with no parser.`);

        // H-4: pre-fetch git history for every non-DELETE file BEFORE opening
        // the transaction, so the transaction body below contains zero `await`
        // (no git subprocess spawn while BEGIN is held).
        const historyFiles = results
            .filter(r => r.status === 'success' && r.event.event !== 'DELETE')
            .map(r => r.event.file_path);
        const historyByFile = await this.prefetchHistories(historyFiles);

        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;

        const symbolCache = new Map<string, number>();
        // A-4: node ids touched by this batch (created/replaced nodes + endpoints
        // of edges created here) so fan-metric reconciliation is scoped to them.
        const changedNodeIds = new Set<number>();
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
                        const history = this.gitService ? historyByFile.get(res.event.file_path) : undefined;
                        for (const node of res.delta.nodes) {
                            node.tags = StructuralTagger.tagNode(node);
                            if (history) node.history = history;
                            const nodeId = this.nodeRepo.createNode(node);
                            symbolCache.set(toCanonical(node.qualified_name), nodeId);
                            changedNodeIds.add(nodeId);
                        }
                    }
                }
            }

            // Pass 2: Relations
            for (const res of results) {
                if (res.status === 'success' && res.event.event !== 'DELETE') {
                    const imports = importedFiles(res.delta);
                    for (const edge of res.delta.edges) {
                        const fromId = this.resolveNodeId(edge, 'from', symbolCache);
                        const toId = this.resolveNodeId(edge, 'to', symbolCache, imports);

                        if (fromId !== undefined && toId !== undefined) {
                            this.edgeRepo.createEdge({ ...edge, from_id: fromId, to_id: toId });
                            // A-4: the edge's endpoints may live in files outside
                            // this batch (cross-file calls) but their fan metrics
                            // still change, so include them in the reconcile set.
                            changedNodeIds.add(fromId);
                            changedNodeIds.add(toId);
                        }
                    }
                }
            }

            // A-4: reconcile fan_in / fan_out for the batch's changed nodes only
            // (the triggers already maintained them incrementally).
            this.recomputeFanMetrics(changedNodeIds);

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
                    log.error(`[UpdatePipeline] Skipping lastIndexedCommit advance to ${targetCommit}: ${failedFiles.length} file(s) failed and will be retried — ${failedFiles.map(f => f.event.file_path).join(', ')}`);
                }
            }

            // Trigger embedding update in background
            this.embeddingManager.refreshAll().catch(err => {
                log.error(`[UpdatePipeline] Background embedding refresh failed: ${err}`);
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
        // H-4: pre-fetch git history BEFORE opening the transaction so the
        // transaction body below is purely synchronous (no await under BEGIN).
        const history = this.gitService
            ? (await this.prefetchHistories([filePath])).get(filePath)
            : undefined;

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

            const symbolCache = new Map<string, number>();
            const changedNodeIds = new Set<number>();
            for (const node of delta.nodes) {
                node.tags = StructuralTagger.tagNode(node);
                if (history) node.history = history;
                const nodeId = this.nodeRepo.createNode(node);
                symbolCache.set(toCanonical(node.qualified_name), nodeId);
                changedNodeIds.add(nodeId);
            }

            const imports = importedFiles(delta);
            for (const edge of delta.edges) {
                const fromId = this.resolveNodeId(edge, 'from', symbolCache);
                const toId = this.resolveNodeId(edge, 'to', symbolCache, imports);
                if (fromId !== undefined && toId !== undefined) {
                    this.edgeRepo.createEdge({ ...edge, from_id: fromId, to_id: toId });
                    changedNodeIds.add(fromId);
                    changedNodeIds.add(toId);
                }
            }

            // A-4: reconcile fan_in / fan_out for the changed nodes only
            // (the triggers already maintained them incrementally).
            this.recomputeFanMetrics(changedNodeIds);

            // P7: replace this file's test specs with the freshly-parsed set.
            // On MODIFY we always clear first so specs deleted from the source
            // (e.g. a removed it() block) don't linger; on ADD the delete is a no-op.
            if (type === 'MODIFY' || (delta.testSpecs && delta.testSpecs.length > 0)) {
                this.db.prepare('DELETE FROM test_specs WHERE file_path = ?').run(filePath);
            }
            if (delta.testSpecs && delta.testSpecs.length > 0) {
                const insertSpec = this.db.prepare(
                    'INSERT INTO test_specs (test_qname, title, target_qname, assertions, file_path, start_line) VALUES (?, ?, ?, ?, ?, ?)'
                );
                for (const spec of delta.testSpecs) {
                    insertSpec.run(spec.testQname, spec.title, spec.targetQname ?? null, JSON.stringify(spec.assertions), spec.filePath, spec.startLine);
                }
            }

            this.db.prepare('COMMIT').run();
            this.graphEngine?.invalidateCache();

            // Trigger embedding update in background
            this.embeddingManager.refreshAll().catch(err => {
                log.error(`[UpdatePipeline] Background embedding refresh failed: ${err}`);
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
            // P7: drop any test specs captured from the deleted file.
            this.db.prepare('DELETE FROM test_specs WHERE file_path = ?').run(filePath);
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

        // H-3: if a prior watermark exists but its commit was rewritten away
        // (rebase/force-push/shallow fetch), an incremental diff against it
        // would fail and the watermark would never advance again. Detect that
        // up front and fall back to a full scan to recover the watermark.
        let useFullScan = !lastCommit;
        if (lastCommit && !(await this.gitService.commitExists(lastCommit))) {
            log.error(`[UpdatePipeline] lastIndexedCommit ${lastCommit} is missing from the repo (rebase/force-push?); falling back to full scan to recover.`);
            useFullScan = true;
        }

        let result;
        if (useFullScan) {
            result = await new FullScanStrategy(this.gitService).buildEvents(projectPath);
        } else {
            try {
                result = await new IncrementalSyncStrategy(this.gitService, lastCommit!, currentHead).buildEvents(projectPath);
            } catch (err) {
                if (err instanceof DiffFailedError) {
                    // Secondary safety net: the diff failed for a reason the
                    // up-front commitExists() check didn't catch. Recover via
                    // full scan rather than stalling.
                    log.error(`[UpdatePipeline] Incremental diff failed (${err.message}); falling back to full scan.`);
                    result = await new FullScanStrategy(this.gitService).buildEvents(projectPath);
                } else {
                    throw err;
                }
            }
        }
        if (!result) return;

        await this.processBatch(result.events, Date.now(), result.head);
    }

    /**
     * A-4: reconciles fan_in / fan_out for the nodes touched by this batch only.
     *
     * The schema's edges_ai/ad/au_metrics triggers already maintain fan_in /
     * fan_out incrementally on every edge insert/delete/update, so the previous
     * full-table correlated-subquery UPDATE (over EVERY node, on every watcher
     * flush) was duplicate work that scaled with graph size rather than batch
     * size. We keep a bounded reconciliation pass as a safety net against any
     * drift, but scope it to the changed node set (the nodes created/replaced in
     * this batch plus the endpoints of edges created in this batch). When the
     * set is empty there is nothing to reconcile.
     */
    private recomputeFanMetrics(changedNodeIds?: Iterable<number>): void {
        if (changedNodeIds === undefined) {
            // Backward-compatible full reconciliation (used outside batch paths).
            this.db.prepare(
                'UPDATE nodes SET ' +
                'fan_in  = (SELECT COUNT(*) FROM edges WHERE to_id   = nodes.id AND edge_type = ?), ' +
                'fan_out = (SELECT COUNT(*) FROM edges WHERE from_id = nodes.id AND edge_type = ?)'
            ).run('calls', 'calls');
            return;
        }

        const ids = Array.from(new Set(changedNodeIds));
        if (ids.length === 0) return;

        const stmt = this.db.prepare(
            'UPDATE nodes SET ' +
            'fan_in  = (SELECT COUNT(*) FROM edges WHERE to_id   = nodes.id AND edge_type = \'calls\'), ' +
            'fan_out = (SELECT COUNT(*) FROM edges WHERE from_id = nodes.id AND edge_type = \'calls\') ' +
            'WHERE nodes.id = ?'
        );
        for (const id of ids) stmt.run(id);
    }

    private resolveNodeId(edge: any, side: 'from' | 'to', internalMap: Map<string, number>, imports: ReadonlySet<string> = new Set()): number | undefined {
        if (side === 'to' && edge.edge_type === 'calls') {
            return this.resolveCallTarget(edge.from_qname, edge.to_qname, internalMap, imports);
        }
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
    /**
     * Resolves a call target. Parsers resolve what they can see to a full qname;
     * the rest arrives as source text, which is resolved here against the whole
     * index, scoped by the caller's imports:
     *
     * - `name`: a function or type of that name. Preference goes to the
     *   caller's file, then files it imports, then its directory (a Go package,
     *   a Java package). An ambiguous name with no candidate in scope is left
     *   unresolved: picking one would fabricate an edge.
     * - `Q.name`: first a function in an imported file whose module is `Q`
     *   (Go `util.Format`, Rust `util::log`), then, when `Q` is capitalized
     *   like a type, a member of the type `Q` (Java `Util.log`, Rust
     *   `Client::new`), preferred the same way.
     * - A qualifier that is a variable (`c.configure`) or an expression is left
     *   unresolved, since its type is unknown here.
     */
    private resolveCallTarget(fromQName: string, target: string, internalMap: Map<string, number>, imports: ReadonlySet<string>): number | undefined {
        const lookup = (qname: string): number | undefined => {
            const canonical = toCanonical(qname);
            return internalMap.get(canonical) ?? this.nodeRepo.getNodeByQualifiedName(canonical)?.id;
        };
        const exact = lookup(target);
        if (exact !== undefined) return exact;

        const callerFile = toCanonical(fromQName.split('#')[0]);
        const qualified = /^(.+)\.([^.]+)$/s.exec(target);
        let candidates: CodeNode[];
        if (target.includes('#')) {
            candidates = [];
        } else if (!qualified) {
            candidates = this.nodeRepo.findNodesBySymbolName(target).filter(isCallable);
        } else {
            const [, qualifier, name] = qualified;
            if (/[()\[\]]/.test(qualifier)) return undefined;
            const last = qualifier.slice(qualifier.lastIndexOf('.') + 1);
            for (const file of imports) {
                if (!moduleNames(file).includes(last.toLowerCase())) continue;
                const id = lookup(`${file}#${name}`);
                if (id !== undefined) return id;
            }
            // Qnames are lowercase, so `logger.log` would match type `Logger`.
            // Only a qualifier written like a type is treated as one.
            candidates = /^[A-Z]/.test(last)
                ? this.nodeRepo.findNodesBySymbolName(`${last}.${name}`).filter(isCallable)
                : [];
        }

        if (candidates.length > 0) {
            const fileOf = (n: CodeNode) => toCanonical(n.file_path);
            const callerDir = path.posix.dirname(callerFile);
            const inScope = candidates.find(n => fileOf(n) === callerFile)
                ?? candidates.find(n => imports.has(fileOf(n)))
                ?? candidates.find(n => path.posix.dirname(fileOf(n)) === callerDir);
            if (inScope) return inScope.id;
            return candidates.length === 1 ? candidates[0].id : undefined;
        }

        // Boundaryless Edge Discovery (Task 31)
        return this.crossProjectResolver?.resolve(target, toCanonical(target));
    }
}

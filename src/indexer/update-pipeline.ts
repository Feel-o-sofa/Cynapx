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

        const symbolCache = new Map<string, number>();

        try {
            this.db.prepare('BEGIN').run();
            
            // 2.1 Pre-resolve all potential target nodes in this batch to minimize individual SELECTs
            const targetQNames = new Set<string>();
            for (const res of results) {
                if (res.status === 'success') {
                    res.delta.edges.forEach(e => {
                        const target = (e as any).to_qname;
                        if (target) targetQNames.add(target);
                    });
                }
            }
            
            if (targetQNames.size > 0) {
                const qnameList = Array.from(targetQNames);
                // Split into chunks of 999 (SQLite limit for IN clause)
                for (let i = 0; i < qnameList.length; i += 999) {
                    const chunk = qnameList.slice(i, i + 999);
                    const placeholders = chunk.map(() => '?').join(',');
                    const stmt = this.db.prepare(`SELECT id, qualified_name FROM nodes WHERE qualified_name IN (${placeholders})`);
                    const rows = stmt.all(...chunk) as { id: number, qualified_name: string }[];
                    rows.forEach(r => symbolCache.set(r.qualified_name, r.id));
                }
            }

            for (const res of results) {
                if (res.status === 'success') {
                    if (res.event.event === 'ADD' || res.event.event === 'MODIFY' || res.event.event === 'DELETE') {
                        this.handleDelete(res.event.file_path);
                    }
                    if (res.event.event === 'ADD' || res.event.event === 'MODIFY') {
                        for (const node of res.delta.nodes) {
                            const nodeId = this.nodeRepo.createNode(node);
                            symbolCache.set(node.qualified_name, nodeId);
                        }

                        for (const edge of res.delta.edges) {
                            const fromId = this.resolveNodeId(edge, 'from', symbolCache);
                            const toId = this.resolveNodeId(edge, 'to', symbolCache);

                            if (fromId !== undefined && toId !== undefined) {
                                this.edgeRepo.createEdge({ ...edge, from_id: fromId, to_id: toId });
                            }
                        }
                    }
                }
            }

            // 3. Ledger Check (Consistency Verification - Sampling or Deferred for performance)
            if (events.length > 100 || Math.random() < 0.1) {
                this.verifyLedger();
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
     * Verifies that the global ledger (metadata) matches the sum of individual node metrics.
     * This ensures 'Conservation of Call Edges' for both static and dynamic calls.
     */
    private verifyLedger(): void {
        if (!this.metadataRepo) return;
        
        // 1. Static Calls Ledger
        const totalCalls = this.metadataRepo.getTotalCallsCount();
        const sumFanIn = (this.db.prepare('SELECT SUM(fan_in) as s FROM nodes').get() as any).s || 0;
        const sumFanOut = (this.db.prepare('SELECT SUM(fan_out) as s FROM nodes').get() as any).s || 0;

        console.log(`[Ledger Check: Static] Global: ${totalCalls}, Sum(In): ${sumFanIn}, Sum(Out): ${sumFanOut}`);

        if (totalCalls !== sumFanIn || totalCalls !== sumFanOut) {
            console.error(`!!! STATIC LEDGER INCONSISTENCY DETECTED !!!`);
            console.error(`Difference: In: ${sumFanIn - totalCalls}, Out: ${sumFanOut - totalCalls}`);
        }

        // 2. Dynamic Calls Ledger
        const totalDynamicCalls = this.metadataRepo.getTotalDynamicCallsCount();
        const sumFanInDynamic = (this.db.prepare('SELECT SUM(fan_in_dynamic) as s FROM nodes').get() as any).s || 0;
        const sumFanOutDynamic = (this.db.prepare('SELECT SUM(fan_out_dynamic) as s FROM nodes').get() as any).s || 0;

        console.log(`[Ledger Check: Dynamic] Global: ${totalDynamicCalls}, Sum(In): ${sumFanInDynamic}, Sum(Out): ${sumFanOutDynamic}`);

        if (totalDynamicCalls !== sumFanInDynamic || totalDynamicCalls !== sumFanOutDynamic) {
            console.error(`!!! DYNAMIC LEDGER INCONSISTENCY DETECTED !!!`);
            console.error(`Difference: In: ${sumFanInDynamic - totalDynamicCalls}, Out: ${sumFanOutDynamic - totalDynamicCalls}`);
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

            // 3. Ledger Check (Sampled)
            if (Math.random() < 0.1) {
                this.verifyLedger();
            }

            this.db.prepare('COMMIT').run();
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
            this.handleDelete(filePath);
            this.verifyLedger();
            this.db.prepare('COMMIT').run();
        } catch (e) {
            if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
            throw e;
        } finally {
            resolveLock!();
        }
    }

    /**
     * Removes all nodes and edges associated with a file.
     */
    private handleDelete(filePath: string): void {
        // Delete the nodes defined in this file. 
        // ON DELETE CASCADE on edges table will automatically handle edge removal,
        // and our new AFTER DELETE trigger will handle metric decrements.
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

        let resolvedId: number | undefined;

        // Check database with file hint if available
        if (fileHint) {
            const nodes = this.nodeRepo.getNodesByFilePath(fileHint);
            const targetNode = nodes.find(n => n.qualified_name === qname || n.qualified_name.endsWith(`.${qname}`));
            if (targetNode) resolvedId = targetNode.id;
        }

        // Fallback to name-only lookup (Exact Match)
        if (resolvedId === undefined) {
            const existingNode = this.nodeRepo.getNodeByQualifiedName(qname);
            if (existingNode) resolvedId = existingNode.id;
        }

        // Heuristic Suffix Match
        if (resolvedId === undefined && side === 'to' && !qname.includes('#') && !qname.includes('/')) {
            const candidates = this.nodeRepo.findNodesBySymbolName(qname);
            if (candidates.length > 0) {
                resolvedId = candidates[0].id;
            }
        }

        if (resolvedId !== undefined) {
            internalMap.set(qname, resolvedId);
        }

        return resolvedId;
    }
}
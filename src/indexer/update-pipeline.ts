import { Database } from 'better-sqlite3';
import * as path from 'path';
import { NodeRepository } from '../db/node-repository';
import { EdgeRepository } from '../db/edge-repository';
import { MetadataRepository } from '../db/metadata-repository';
import { GitService } from './git-service';
import { FileChangeEvent, CodeParser, DeltaGraph, ChangeType } from './types';
import { WorkerPool } from './worker-pool';
import { toCanonical } from '../utils/paths';

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
            console.log(`Processing ${type} for ${file_path}`);

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
        console.log(`Processing batch of ${events.length} files...`);
        
        const results = await Promise.all(events.map(async (event) => {
            if (event.event === 'DELETE') return { event, delta: { nodes: [], edges: [] }, status: 'success' as const };
            try {
                const delta = this.workerPool 
                    ? await this.workerPool.runTask({ filePath: event.file_path, commit: event.commit, version })
                    : await this.parser.parse(event.file_path, event.commit, version);
                return { event, delta, status: 'success' as const };
            } catch (error) {
                console.error(`Failed to parse ${event.file_path}:`, error);
                return { event, status: 'error' as const };
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
                    this.nodeRepo.deleteNodesByFilePath(res.event.file_path);
                    if (res.event.event !== 'DELETE') {
                        for (const node of res.delta.nodes) {
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

            this.db.prepare('COMMIT').run();
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
            if (type === 'MODIFY') this.nodeRepo.deleteNodesByFilePath(filePath);

            const symbolCache = new Map<string, number>();
            for (const node of delta.nodes) {
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
        return undefined;
    }
}

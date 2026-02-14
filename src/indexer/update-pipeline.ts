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
import { toCanonical, readRegistry } from '../utils/paths';
import { StructuralTagger } from './structural-tagger';
import { CodeNode } from '../types';

/**
 * UpdatePipeline manages the incremental update process for the knowledge graph.
 */
export class UpdatePipeline {
    constructor(
        private db: SQLiteDatabase.Database,
        private nodeRepo: NodeRepository,
        private edgeRepo: EdgeRepository,
        private parser: CodeParser,
        private metadataRepo?: MetadataRepository,
        private gitService?: GitService,
        private workerPool?: WorkerPool,
        private projectPath?: string
    ) { }

    private writeLock: Promise<void> = Promise.resolve();

    public async reTagAllNodes(): Promise<void> {
        const nodes = this.nodeRepo.getAllNodes();
        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;

        try {
            this.db.prepare('BEGIN').run();
            
            // 1. First pass: Initialize node map with baseline tags
            const nodeMap = new Map<number, { node: CodeNode, tags: string[] }>();
            for (const node of nodes) {
                if (node.id) {
                    const baselineTags = StructuralTagger.tagNode(node);
                    nodeMap.set(node.id, { node, tags: baselineTags });
                }
            }

            // 2. Second pass: Propagate roles via inheritance (multiple passes to reach stability)
            for (let i = 0; i < 5; i++) {
                let changed = false;
                for (const [id, data] of nodeMap.entries()) {
                    const outgoing = this.edgeRepo.getOutgoingEdges(id).filter(e => e.edge_type === 'inherits' || e.edge_type === 'implements');
                    
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

            // 3. Persist updated tags to DB
            const updateStmt = this.db.prepare('UPDATE nodes SET tags = ? WHERE id = ?');
            for (const [id, data] of nodeMap.entries()) {
                updateStmt.run(JSON.stringify(data.tags), id);
            }

            this.db.prepare('COMMIT').run();
        } catch (e) {
            if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
            throw e;
        } finally {
            resolveLock!();
        }
    }

    public async mapHistoryToProject(): Promise<void> {
        if (!this.gitService) return;
        const filePaths = this.nodeRepo.getAllFilePaths();
        console.log(`Backfilling history for ${filePaths.length} files...`);

        const previousLock = this.writeLock;
        let resolveLock: () => void;
        this.writeLock = new Promise((resolve) => { resolveLock = resolve; });
        await previousLock;

        try {
            this.db.prepare('BEGIN').run();
            for (const filePath of filePaths) {
                const history = await this.gitService.getHistoryForFile(filePath);
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
    }

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

        // Boundaryless Edge Discovery (Task 31)
        // If not found locally, search across other registered projects
        if (side === 'to' && this.projectPath) {
            const registry = readRegistry();
            const otherProjects = registry.filter(p => p.path.toLowerCase() !== this.projectPath!.toLowerCase());
            
            // Extract pure symbol name if it contains # (e.g. "path/to/file.ts#MyClass" -> "MyClass")
            const symbolName = qname.includes('#') ? qname.split('#').pop()! : qname;

            for (const project of otherProjects) {
                try {
                    if (!require('fs').existsSync(project.db_path)) continue;

                    const remoteDb = new SQLiteDatabase(project.db_path, { readonly: true });
                    // Try exact match first, then suffix match with symbol name
                    const remoteStmt = remoteDb.prepare("SELECT * FROM nodes WHERE qualified_name = ? COLLATE NOCASE OR qualified_name LIKE ? COLLATE NOCASE LIMIT 1");
                    const remoteMatch = remoteStmt.get(canonicalQName, `%#${symbolName}`) as any;
                    remoteDb.close();

                    if (remoteMatch) {
                        // Create a Shadow Node in the local DB
                        const shadowNodeId = this.nodeRepo.createNode({
                            qualified_name: `remote:${project.name}:${remoteMatch.qualified_name}`,
                            symbol_type: remoteMatch.symbol_type,
                            language: remoteMatch.language,
                            file_path: remoteMatch.file_path, // Remote file path
                            start_line: remoteMatch.start_line,
                            end_line: remoteMatch.end_line,
                            visibility: remoteMatch.visibility,
                            is_generated: true,
                            last_updated_commit: 'remote',
                            version: 0,
                            remote_project_path: project.path,
                            signature: remoteMatch.signature,
                            return_type: remoteMatch.return_type,
                            tags: remoteMatch.tags ? JSON.parse(remoteMatch.tags) : undefined,
                            history: remoteMatch.history ? JSON.parse(remoteMatch.history) : undefined
                        });
                        return shadowNodeId;
                    }
                } catch (err) {
                    // Silently ignore errors for specific remote DBs
                }
            }
        }

        return undefined;
    }
}

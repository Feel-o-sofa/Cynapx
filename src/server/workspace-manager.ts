/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { GraphEngine } from '../graph/graph-engine';
import { DatabaseManager } from '../db/database';
import { MetadataRepository } from '../db/metadata-repository';
import { VectorRepository } from '../db/vector-repository';
import { ArchitectureEngine } from '../graph/architecture-engine';
import { RefactoringEngine } from '../graph/refactoring-engine';
import { OptimizationEngine } from '../graph/optimization-engine';
import { PolicyDiscoverer } from '../graph/policy-discoverer';
import { NodeRepository } from '../db/node-repository';
import { EdgeRepository } from '../db/edge-repository';
import { getDatabasePath, getProjectHash } from '../utils/paths';

export interface EngineContext {
    projectPath: string;
    projectHash: string;
    dbManager?: DatabaseManager;
    graphEngine?: GraphEngine;
    metadataRepo?: MetadataRepository;
    vectorRepo?: VectorRepository;
    archEngine?: ArchitectureEngine;
    refactorEngine?: RefactoringEngine;
    optEngine?: OptimizationEngine;
    policyDiscoverer?: PolicyDiscoverer;
}

/**
 * WorkspaceManager orchestrates multiple project engines within a single session.
 */
export class WorkspaceManager {
    private contexts = new Map<string, EngineContext>();
    private activeProjectId: string | null = null;

    /**
     * Mounts a project into the workspace (Registration only, no DB open).
     */
    public async mountProject(projectPath: string): Promise<EngineContext> {
        const hash = getProjectHash(projectPath);
        if (this.contexts.has(hash)) {
            return this.contexts.get(hash)!;
        }

        const context: EngineContext = {
            projectPath,
            projectHash: hash
        };

        this.contexts.set(hash, context);
        if (!this.activeProjectId) {
            this.activeProjectId = hash;
        }

        return context;
    }

    /**
     * Fully initializes the engine for a project (Opens DB).
     * Should only be called by the Host process.
     */
    public async initializeEngine(hash: string): Promise<EngineContext> {
        const ctx = this.contexts.get(hash);
        if (!ctx) throw new Error(`Project ${hash} not mounted.`);
        if (ctx.dbManager) return ctx; // Already initialized

        const dbPath = getDatabasePath(ctx.projectPath);
        const dbManager = new DatabaseManager(dbPath);
        const db = dbManager.getDb();
        
        const nodeRepo = new NodeRepository(db);
        const edgeRepo = new EdgeRepository(db);
        const metadataRepo = new MetadataRepository(db);
        const graphEngine = new GraphEngine(nodeRepo, edgeRepo);
        const vectorRepo = new VectorRepository(db);

        ctx.dbManager = dbManager;
        ctx.graphEngine = graphEngine;
        ctx.metadataRepo = metadataRepo;
        ctx.vectorRepo = vectorRepo;
        ctx.archEngine = new ArchitectureEngine(graphEngine);
        ctx.refactorEngine = new RefactoringEngine(graphEngine);
        ctx.optEngine = new OptimizationEngine(graphEngine);
        ctx.policyDiscoverer = new PolicyDiscoverer(graphEngine);

        return ctx;
    }

    public getActiveContext(): EngineContext | null {
        if (!this.activeProjectId) return null;
        return this.contexts.get(this.activeProjectId) || null;
    }

    public setActiveProject(hash: string): boolean {
        if (this.contexts.has(hash)) {
            this.activeProjectId = hash;
            return true;
        }
        return false;
    }

    public getAllContexts(): EngineContext[] {
        return Array.from(this.contexts.values());
    }

    public getContextByHash(hash: string): EngineContext | undefined {
        return this.contexts.get(hash);
    }

    public async dispose() {
        for (const ctx of this.contexts.values()) {
            if (ctx.dbManager) ctx.dbManager.dispose();
        }
        this.contexts.clear();
    }
}

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import * as path from 'path';
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
import { getDatabasePath, getProjectHash, updateRegistryStats } from '../utils/paths';
import { loadProfile, ProjectProfile } from '../utils/profile';
import { getAuditLogger } from '../utils/audit-logger';
import { GitService } from '../indexer/git-service';
import { UpdatePipeline } from '../indexer/update-pipeline';
import { SecurityProvider } from '../utils/security';

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
    gitService?: GitService;
    updatePipeline?: UpdatePipeline;
    securityProvider?: SecurityProvider;
    /** Project-specific indexing/analysis profile (loaded from ~/.cynapx/profiles/{hash}.json) */
    profile?: ProjectProfile;
    /** Set to true when a version mismatch auto-reindex was triggered at init */
    reindexTriggeredByVersion?: boolean;
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
     *
     * Version check (Req-3): compares the Cynapx version stored in the DB against the
     * running binary's version. On a major or minor version change the index is purged
     * and a full reindex is requested by setting ctx.reindexTriggeredByVersion = true.
     */
    public async initializeEngine(hash: string): Promise<EngineContext> {
        const ctx = this.contexts.get(hash);
        if (!ctx) throw new Error(`Project ${hash} not mounted.`);
        if (ctx.dbManager) return ctx; // Already initialized

        // Load project profile (A-2)
        ctx.profile = loadProfile(ctx.projectPath);

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

        // Version mismatch detection (Req-3)
        const audit = getAuditLogger();
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const currentVersion: string = require('../../package.json').version as string;
            const storedVersion = metadataRepo.getCynapxVersion();
            if (storedVersion && storedVersion !== '' && storedVersion !== currentVersion) {
                const storedMajorMinor = storedVersion.split('.').slice(0, 2).join('.');
                const currentMajorMinor = currentVersion.split('.').slice(0, 2).join('.');
                if (storedMajorMinor !== currentMajorMinor) {
                    audit.log('version_mismatch', {
                        project: ctx.projectPath,
                        storedVersion,
                        currentVersion
                    });
                    audit.log('reindex_triggered', {
                        project: ctx.projectPath,
                        reason: `version mismatch: ${storedVersion} → ${currentVersion}`
                    });
                    console.error(
                        `[WorkspaceManager] Version mismatch for ${ctx.projectPath}: ` +
                        `stored=${storedVersion}, current=${currentVersion}. ` +
                        `Triggering full reindex.`
                    );
                    // Purge existing index data
                    db.transaction(() => {
                        db.prepare('DELETE FROM edges').run();
                        db.prepare('DELETE FROM nodes').run();
                        db.prepare("DELETE FROM index_metadata WHERE key = 'last_indexed_commit'").run();
                    })();
                    ctx.reindexTriggeredByVersion = true;
                }
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[WorkspaceManager] Version check failed (non-fatal): ${msg}`);
        }

        // Load optional custom architecture rules
        const archRulesPath = path.join(ctx.projectPath, 'arch-rules.json');
        if (fs.existsSync(archRulesPath)) {
            try {
                ctx.archEngine.loadRules(archRulesPath);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[WorkspaceManager] Warning: failed to load arch-rules.json: ${msg}`);
            }
        }

        ctx.refactorEngine = new RefactoringEngine(graphEngine);
        ctx.optEngine = new OptimizationEngine(graphEngine);
        ctx.policyDiscoverer = new PolicyDiscoverer(graphEngine);

        return ctx;
    }

    /**
     * Called by the indexing pipeline after a successful full index run.
     * Persists version + timestamp into DB metadata and updates the registry (Req-1+3).
     */
    public async onIndexComplete(hash: string, nodeCount: number, edgeCount: number): Promise<void> {
        const ctx = this.contexts.get(hash);
        if (!ctx || !ctx.metadataRepo) return;

        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const currentVersion: string = require('../../package.json').version as string;
            const now = new Date().toISOString();
            ctx.metadataRepo.setCynapxVersion(currentVersion);
            ctx.metadataRepo.setIndexedAt(now);

            updateRegistryStats(ctx.projectPath, {
                node_count: nodeCount,
                edge_count: edgeCount,
                cynapx_version: currentVersion
            });

            getAuditLogger().log('index_complete', {
                project: ctx.projectPath,
                nodeCount,
                edgeCount,
                version: currentVersion
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[WorkspaceManager] onIndexComplete failed (non-fatal): ${msg}`);
        }
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

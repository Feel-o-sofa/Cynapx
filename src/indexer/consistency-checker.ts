/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

import { Database } from 'better-sqlite3';
import { NodeRepository } from '../db/node-repository';
import { GitService } from './git-service';
import { UpdatePipeline } from './update-pipeline';
import { FileFilter } from '../utils/file-filter';
import { loadProfile } from '../utils/profile';
import { calculateFileChecksum } from '../utils/checksum';
import { LanguageRegistry } from './language-registry';
import { SecurityProvider } from '../utils/security';
import { FileChangeEvent } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';


const log = new Logger('ConsistencyChecker');
/**
 * ConsistencyChecker validates the integrity of the knowledge graph against the file system and Git.
 */
export class ConsistencyChecker {
    private securityProvider: SecurityProvider;

    constructor(
        private nodeRepo: NodeRepository,
        private gitService: GitService,
        private pipeline: UpdatePipeline,
        private projectPath: string
    ) { 
        this.securityProvider = new SecurityProvider(projectPath);
    }

    /**
     * Performs a full consistency check and returns the results.
     * If 'repair' is true, it triggers re-indexing for inconsistent files.
     * If 'force' is true, it treats all files as outdated to trigger a full re-index.
     */
    public async validate(repair: boolean = false, force: boolean = false): Promise<{
        totalFiles: number;
        missingFiles: string[];
        outdatedFiles: string[];
        orphanedNodes: string[];
    }> {
        log.info(`Starting Consistency Check (Repair: ${repair}, Force: ${force})...`);
        
        const results = {
            totalFiles: 0,
            missingFiles: [] as string[],
            outdatedFiles: [] as string[],
            orphanedNodes: [] as string[]
        };

        // A-6: honour the project profile's excludePatterns / maxFileSize here
        // too, so file discovery and the watcher apply the same filter set.
        const profile = loadProfile(this.projectPath);
        const fileFilter = new FileFilter(this.projectPath, {
            excludePatterns: profile.excludePatterns,
            maxFileSize: profile.maxFileSize,
        });
        const allPhysicalFiles = await this.getFiles(this.projectPath, true, fileFilter);
        results.totalFiles = allPhysicalFiles.length;

        if (force) {
            results.outdatedFiles = [...allPhysicalFiles];
        } else {
            // 1. Check for Outdated or Missing files (Throttled Parallelization)
            const CONCURRENCY_LIMIT = 10;
            const chunks = [];
            for (let i = 0; i < allPhysicalFiles.length; i += CONCURRENCY_LIMIT) {
                chunks.push(allPhysicalFiles.slice(i, i + CONCURRENCY_LIMIT));
            }

            for (const chunk of chunks) {
                await Promise.all(chunk.map(async (fullPath) => {
                    const nodes = this.nodeRepo.getNodesByFilePath(fullPath);
                    const fileNode = nodes.find(n => n.symbol_type === 'file');

                    if (!fileNode) {
                        results.missingFiles.push(fullPath);
                        return;
                    }

                    const [currentGitCommit, currentChecksum] = await Promise.all([
                        this.gitService.getLatestCommit(fullPath),
                        Promise.resolve(calculateFileChecksum(fullPath))
                    ]);

                    // Advanced Consistency Logic:
                    // 1. If checksum differs, it's definitely outdated.
                    // 2. If checksum matches, but DB has a placeholder 'watcher-change', it's considered consistent with disk.
                    // 3. If checksum matches, but DB has an old Git hash, it's outdated relative to Git (needs commit metadata update).
                    const checksumMatches = fileNode.checksum === currentChecksum;
                    const isWatcherChange = fileNode.last_updated_commit === 'watcher-change';
                    
                    let isOutdated = !checksumMatches;
                    if (checksumMatches && !isWatcherChange && fileNode.last_updated_commit !== currentGitCommit) {
                        isOutdated = true;
                    }

                    if (isOutdated) {
                        results.outdatedFiles.push(fullPath);
                    }
                }));
            }
        }

        // 2. Check for Orphaned nodes in DB (Files that no longer exist on disk)
        const allDbFiles = this.nodeRepo.getAllFilePaths();
        for (const dbPath of allDbFiles) {
            if (!fs.existsSync(dbPath)) {
                results.orphanedNodes.push(dbPath);
            }
        }

        log.info('Consistency check results', {
            missing: results.missingFiles.length,
            outdated: results.outdatedFiles.length,
            orphaned: results.orphanedNodes.length
        });

        if (repair) {
            await this.repair(results);
        }

        return results;
    }

    private async repair(results: {
        missingFiles: string[];
        outdatedFiles: string[];
        orphanedNodes: string[];
    }): Promise<void> {
        log.info('Repairing inconsistencies...');
        const version = Date.now();

        // Fetch all latest commits in parallel
        const repairFiles = [...results.missingFiles, ...results.outdatedFiles];
        const events: FileChangeEvent[] = await Promise.all(repairFiles.map(async (f) => {
            const commit = await this.gitService.getLatestCommit(f);
            return { event: 'MODIFY' as const, file_path: f, commit };
        }));

        // Add delete events
        for (const f of results.orphanedNodes) {
            events.push({ event: 'DELETE' as const, file_path: f, commit: 'deleted' });
        }

        if (events.length > 0) {
            await this.pipeline.processBatch(events, version);
            log.info(`Repair complete. Processed ${events.length} files.`);
        } else {
            log.info('Nothing to repair.');
        }
    }

    private async getFiles(directory: string, recursive: boolean, filter?: FileFilter): Promise<string[]> {
        const results: string[] = [];
        this.securityProvider.validatePath(directory);
        
        if (!fs.existsSync(directory)) return results;
        
        const extensions = LanguageRegistry.getInstance().getAllExtensions();
        if (directory === this.projectPath) {
            log.error(`Scanning directory: ${directory}`);
            log.error(`Supported extensions: ${extensions.join(', ')}`);
        }
        
        const files = fs.readdirSync(directory);
        for (const file of files) {
            const fullPath = path.resolve(directory, file);
            // Pattern-level prune for both dirs and files (cheap, no stat).
            if (filter && filter.isIgnored(fullPath)) continue;
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                if (recursive) {
                    const subFiles = await this.getFiles(fullPath, true, filter);
                    results.push(...subFiles);
                }
            } else {
                const ext = file.split('.').pop()?.toLowerCase();
                if (ext && LanguageRegistry.getInstance().getAllExtensions().includes(ext)) {
                    // A-6: honour the profile's maxFileSize during discovery.
                    if (filter && filter.shouldIgnoreFile(fullPath)) continue;
                    results.push(fullPath);
                }
            }
        }
        return results;
    }
}

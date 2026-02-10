
import { Database } from 'better-sqlite3';
import { NodeRepository } from '../db/node-repository';
import { GitService } from './git-service';
import { UpdatePipeline } from './update-pipeline';
import { FileFilter } from '../utils/file-filter';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ConsistencyChecker validates the integrity of the knowledge graph against the file system and Git.
 */
export class ConsistencyChecker {
    constructor(
        private nodeRepo: NodeRepository,
        private gitService: GitService,
        private pipeline: UpdatePipeline,
        private projectPath: string
    ) { }

    /**
     * Performs a full consistency check and returns the results.
     * If 'repair' is true, it triggers re-indexing for inconsistent files.
     */
    public async validate(repair: boolean = false): Promise<{
        totalFiles: number;
        missingFiles: string[];
        outdatedFiles: string[];
        orphanedNodes: string[];
    }> {
        console.log('Starting Consistency Check...');
        
        const results = {
            totalFiles: 0,
            missingFiles: [] as string[],
            outdatedFiles: [] as string[],
            orphanedNodes: [] as string[]
        };

        const fileFilter = new FileFilter(this.projectPath);
        const allPhysicalFiles = await this.getFiles(this.projectPath, true, fileFilter);
        results.totalFiles = allPhysicalFiles.length;

        // 1. Check for Outdated or Missing files
        for (const fullPath of allPhysicalFiles) {
            const nodes = this.nodeRepo.getNodesByFilePath(fullPath);
            const fileNode = nodes.find(n => n.symbol_type === 'file');

            if (!fileNode) {
                results.missingFiles.push(fullPath);
                continue;
            }

            const currentGitCommit = await this.gitService.getLatestCommit(fullPath);
            if (fileNode.last_updated_commit !== currentGitCommit) {
                results.outdatedFiles.push(fullPath);
            }
        }

        // 2. Check for Orphaned nodes in DB (Files that no longer exist on disk)
        const allDbFiles = this.nodeRepo.getAllFilePaths();
        for (const dbPath of allDbFiles) {
            if (!fs.existsSync(dbPath)) {
                results.orphanedNodes.push(dbPath);
            }
        }

        console.log(`Consistency Check Results:
- Missing: ${results.missingFiles.length}
- Outdated: ${results.outdatedFiles.length}
- Orphaned: ${results.orphanedNodes.length}`);

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
        console.log('Repairing inconsistencies...');
        const version = Date.now();

        const events: any[] = [];

        // Add missing or outdated
        for (const f of [...results.missingFiles, ...results.outdatedFiles]) {
            const commit = await this.gitService.getLatestCommit(f);
            events.push({ event: 'MODIFY', file_path: f, commit });
        }

        // Delete orphaned
        for (const f of results.orphanedNodes) {
            events.push({ event: 'DELETE', file_path: f, commit: 'deleted' });
        }

        if (events.length > 0) {
            await this.pipeline.processBatch(events, version);
            console.log(`Repair complete. Processed ${events.length} files.`);
        } else {
            console.log('Nothing to repair.');
        }
    }

    private async getFiles(directory: string, recursive: boolean, filter?: FileFilter): Promise<string[]> {
        const results: string[] = [];
        if (!fs.existsSync(directory)) return results;
        
        const files = fs.readdirSync(directory);
        for (const file of files) {
            const fullPath = path.resolve(directory, file);
            if (filter && filter.isIgnored(fullPath)) continue;
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                if (recursive) {
                    const subFiles = await this.getFiles(fullPath, true, filter);
                    results.push(...subFiles);
                }
            } else if (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.py')) {
                results.push(fullPath);
            }
        }
        return results;
    }
}

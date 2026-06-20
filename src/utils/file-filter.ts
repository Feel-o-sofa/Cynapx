/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

import ignore, { Ignore } from 'ignore';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A-6: optional profile-derived filtering applied on top of .gitignore. These
 * are sourced from ProjectProfile so a project profile's excludePatterns /
 * maxFileSize actually take effect (previously loaded but never consumed).
 */
export interface FileFilterOptions {
    /** Extra ignore patterns (gitignore-syntax) layered on top of .gitignore. */
    excludePatterns?: string[];
    /** Files larger than this (bytes) are treated as ignored. 0/undefined = no limit. */
    maxFileSize?: number;
}

export class FileFilter {
    private ig: Ignore;
    private maxFileSize: number;
    /**
     * O-11: nested .gitignore support. Each subdirectory may carry its own
     * .gitignore whose patterns apply (relative to that subdirectory) to its
     * subtree. We load these lazily and memoise which subdirectories have been
     * scanned, so the cost is paid once per directory rather than per file.
     */
    private loadedDirs = new Set<string>();

    constructor(private projectRoot: string, options: FileFilterOptions = {}) {
        this.ig = ignore();
        this.maxFileSize = options.maxFileSize && options.maxFileSize > 0 ? options.maxFileSize : 0;
        this.loadGitIgnore();
        // A-6: layer the profile's excludePatterns on top of .gitignore. The
        // `ignore` package speaks gitignore syntax; the profile's glob defaults
        // (e.g. `**/dist/**`) are accepted directly.
        if (options.excludePatterns && options.excludePatterns.length > 0) {
            this.ig.add(options.excludePatterns);
        }
    }

    private loadGitIgnore() {
        // Minimum safety set: only ignore massive non-source folders and tool artifacts.
        // Everything else should be dictated by the project's own .gitignore.
        this.ig.add(['.git', 'node_modules', '.cynapx']);
        // Root .gitignore (relative dir = '').
        this.loadDirGitignore('');
    }

    /**
     * O-11: load the .gitignore for a single directory (relative to the project
     * root, '' = root) exactly once, scoping its patterns to that subtree.
     */
    private loadDirGitignore(relDir: string): void {
        if (this.loadedDirs.has(relDir)) return;
        this.loadedDirs.add(relDir);

        const gitIgnorePath = path.join(this.projectRoot, relDir, '.gitignore');
        let content: string;
        try {
            content = fs.readFileSync(gitIgnorePath, 'utf8');
        } catch {
            return; // no .gitignore in this directory
        }

        if (relDir === '') {
            this.ig.add(content);
            return;
        }

        // Re-scope each pattern to the subdirectory so it only affects that
        // subtree. Anchored patterns ('/foo') and unanchored ('foo') both become
        // relative to relDir (which is what git does for a nested .gitignore).
        const prefix = relDir.split(path.sep).join('/').replace(/\/$/, '');
        const scoped: string[] = [];
        for (const rawLine of content.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) continue;

            let negated = false;
            let body = trimmed;
            if (body.startsWith('!')) { negated = true; body = body.slice(1); }
            // Strip a leading slash (anchors to the .gitignore's own directory).
            if (body.startsWith('/')) body = body.slice(1);

            const scopedPattern = `${negated ? '!' : ''}${prefix}/${body}`;
            scoped.push(scopedPattern);
        }
        if (scoped.length > 0) this.ig.add(scoped);
    }

    /**
     * O-11: ensure every ancestor directory's .gitignore (from project root down
     * to the file's parent) has been loaded before evaluating an ignore check.
     */
    private ensureAncestorGitignores(relativePath: string): void {
        const parts = relativePath.split(path.sep);
        // Drop the final path component (the file/leaf itself).
        parts.pop();
        let accum = '';
        for (const part of parts) {
            if (part === '' || part === '.') continue;
            accum = accum === '' ? part : `${accum}${path.sep}${part}`;
            this.loadDirGitignore(accum);
        }
    }

    /**
     * Pattern-level ignore check (.gitignore + profile excludePatterns). Does NOT
     * consult the filesystem, so it is safe for paths that no longer exist
     * (e.g. a watcher `unlink` event) and for directory traversal pruning.
     */
    public isIgnored(filePath: string): boolean {
        const relativePath = path.relative(this.projectRoot, filePath);
        if (!relativePath) return false;
        // A path outside the project root (relativePath starts with '..') is not
        // something this project's .gitignore governs — don't ignore it here.
        if (relativePath.startsWith('..')) return false;
        // O-11: lazily load nested .gitignore files along this path first.
        this.ensureAncestorGitignores(relativePath);
        return this.ig.ignores(relativePath);
    }

    /**
     * A-6: full filter for an existing file — pattern ignore OR over the
     * configured max file size. Stats the file only when a size limit is set and
     * the path wasn't already pattern-ignored. Returns true (ignore) if the stat
     * fails for any reason other than the file being absent.
     */
    public shouldIgnoreFile(filePath: string): boolean {
        if (this.isIgnored(filePath)) return true;
        if (this.maxFileSize <= 0) return false;
        try {
            const stat = fs.statSync(filePath);
            if (stat.isFile() && stat.size > this.maxFileSize) return true;
        } catch {
            // Missing file: nothing to index, but not a pattern/size ignore.
            // Treat as "not ignored" so callers handle the delete/absence path.
            return false;
        }
        return false;
    }
}

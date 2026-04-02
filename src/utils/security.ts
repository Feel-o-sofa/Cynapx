/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as path from 'path';
import * as fs from 'fs';
import { CynapxError, CynapxErrorCode } from '../types';

/**
 * SecurityProvider handles centralized file access authority verification.
 * It prevents path traversal attacks by ensuring all accessed files are within the project boundaries.
 */
export class SecurityProvider {
    private projectRoot: string;

    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
    }

    /**
     * Validates if a target path is within the project root.
     * Throws a CynapxError if access is denied.
     */
    public validatePath(targetPath: string): void {
        const resolvedTarget = path.resolve(targetPath);

        // Resolve symlinks when path exists; fall back to path.resolve for new files
        let realTarget: string;
        try {
            realTarget = fs.realpathSync(resolvedTarget);
        } catch {
            realTarget = resolvedTarget;
        }

        let realRoot: string;
        try {
            realRoot = fs.realpathSync(this.projectRoot);
        } catch {
            realRoot = this.projectRoot;
        }

        if (!realTarget.toLowerCase().startsWith(realRoot.toLowerCase())) {
            throw new CynapxError(
                CynapxErrorCode.PATH_TRAVERSAL_DENIED,
                `Access to file outside project directory denied: ${targetPath}`
            );
        }
    }

    /**
     * Checks if a path is allowed without throwing an error.
     */
    public isPathAllowed(targetPath: string): boolean {
        try {
            this.validatePath(targetPath);
            return true;
        } catch {
            return false;
        }
    }

    public getProjectRoot(): string {
        return this.projectRoot;
    }
}

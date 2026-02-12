import * as path from 'path';
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
        const absoluteTargetPath = path.resolve(targetPath);
        const normalizedProjectRoot = this.projectRoot.toLowerCase();
        const normalizedTargetPath = absoluteTargetPath.toLowerCase();

        if (!normalizedTargetPath.startsWith(normalizedProjectRoot)) {
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

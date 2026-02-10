
import ignore, { Ignore } from 'ignore';
import * as fs from 'fs';
import * as path from 'path';

export class FileFilter {
    private ig: Ignore;

    constructor(private projectRoot: string) {
        this.ig = ignore();
        this.loadGitIgnore();
    }

    private loadGitIgnore() {
        const gitIgnorePath = path.join(this.projectRoot, '.gitignore');
        if (fs.existsSync(gitIgnorePath)) {
            const content = fs.readFileSync(gitIgnorePath, 'utf8');
            this.ig.add(content);
        }
        // Minimum safety set: only ignore massive non-source folders and tool artifacts.
        // Everything else should be dictated by the project's own .gitignore.
        this.ig.add(['.git', 'node_modules', '.cynapx']);
    }

    public isIgnored(filePath: string): boolean {
        const relativePath = path.relative(this.projectRoot, filePath);
        if (!relativePath) return false;
        return this.ig.ignores(relativePath);
    }
}

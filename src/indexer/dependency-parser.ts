import { CodeParser, DeltaGraph } from './types';
import { CodeNode, CodeEdge } from '../types';
import * as fs from 'fs';
import { calculateChecksum } from '../utils/checksum';

export class DependencyParser implements CodeParser {
    public supports(filePath: string): boolean {
        return filePath.endsWith('package.json') || filePath.endsWith('requirements.txt');
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const nodes: CodeNode[] = [];
        const edges: CodeEdge[] = [];
        const content = fs.readFileSync(filePath, 'utf8');

        // File Node
        nodes.push({
            qualified_name: filePath,
            symbol_type: 'file',
            language: 'config',
            file_path: filePath,
            start_line: 1,
            end_line: content.split('\n').length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            checksum: calculateChecksum(content),
            loc: content.split('\n').length
        });

        if (filePath.endsWith('package.json')) {
            try {
                const json = JSON.parse(content);
                const deps = { ...json.dependencies, ...json.devDependencies };

                for (const [pkgName, versionSpec] of Object.entries(deps)) {
                    const pkgNodeQName = `package:${pkgName}`;

                    // Package Node (External)
                    nodes.push({
                        qualified_name: pkgNodeQName,
                        symbol_type: 'package',
                        language: 'javascript',
                        file_path: filePath,
                        start_line: 0,
                        end_line: 0,
                        visibility: 'public',
                        is_generated: true,
                        last_updated_commit: commit,
                        version: version,
                        signature: versionSpec as string
                    });

                    // Edge: File -> Package (depends_on)
                    edges.push({
                        from_qname: filePath,
                        to_qname: pkgNodeQName,
                        edge_type: 'depends_on',
                        dynamic: false
                    } as any);
                }
            } catch (e) {
                console.error(`Failed to parse package.json: ${e}`);
            }
        } else if (filePath.endsWith('requirements.txt')) {
            // Python requirements parsing (simple line by line)
            const lines = content.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                // Simple regex to extract package name
                const match = trimmed.match(/^([a-zA-Z0-9_\-]+)/);
                if (match) {
                    const pkgName = match[1];
                    const versionMatch = trimmed.match(/[=<>!~]+(.+)$/);
                    const pkgVersion = versionMatch ? versionMatch[1] : 'latest';
                    const pkgNodeQName = `pypi:${pkgName}`;

                    nodes.push({
                        qualified_name: pkgNodeQName,
                        symbol_type: 'package',
                        language: 'python',
                        file_path: filePath,
                        start_line: 0,
                        end_line: 0,
                        visibility: 'public',
                        is_generated: true,
                        last_updated_commit: commit,
                        version: version,
                        signature: pkgVersion
                    });

                    edges.push({
                        from_qname: filePath,
                        to_qname: pkgNodeQName,
                        edge_type: 'depends_on',
                        dynamic: false
                    } as any);
                }
            }
        }

        return { nodes, edges };
    }
}

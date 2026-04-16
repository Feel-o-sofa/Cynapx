/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { CodeParser, DeltaGraph, RawCodeEdge } from './types';
import { CodeNode } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { calculateChecksum } from '../utils/checksum';
import { toCanonical } from '../utils/paths';

export class JsonConfigParser implements CodeParser {
    // Exclude files already handled by DependencyParser
    private static readonly EXCLUDED = new Set(['package.json', 'package-lock.json', 'requirements.txt']);

    public supports(filePath: string): boolean {
        const basename = path.basename(filePath);
        return (filePath.endsWith('.json') || filePath.endsWith('.jsonc'))
            && !JsonConfigParser.EXCLUDED.has(basename);
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const nodes: CodeNode[] = [];
        const edges: RawCodeEdge[] = [];
        const content = fs.readFileSync(filePath, 'utf8');
        const fileQname = toCanonical(filePath);
        const lines = content.split('\n');

        nodes.push({
            qualified_name: fileQname,
            symbol_type: 'file',
            language: 'json',
            file_path: filePath,
            start_line: 1,
            end_line: lines.length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version,
            checksum: calculateChecksum(content),
            loc: lines.length
        });

        try {
            // Strip JSONC comments for parsing
            const stripped = content.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
            const parsed = JSON.parse(stripped);
            if (typeof parsed === 'object' && parsed !== null) {
                for (const key of Object.keys(parsed)) {
                    const qname = `${fileQname}#${key}`;
                    nodes.push({
                        qualified_name: qname,
                        symbol_type: 'config_key',
                        language: 'json',
                        file_path: filePath,
                        start_line: 1,
                        end_line: 1,
                        visibility: 'public',
                        is_generated: false,
                        last_updated_commit: commit,
                        version
                    });
                    edges.push({ from_qname: fileQname, to_qname: qname, edge_type: 'contains' as const, dynamic: false });
                }
            }
        } catch { /* malformed JSON — file node only */ }

        return { nodes, edges };
    }
}

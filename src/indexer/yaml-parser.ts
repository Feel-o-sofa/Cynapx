/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { CodeParser, DeltaGraph, RawCodeEdge } from './types';
import { CodeNode } from '../types';
import * as fs from 'fs';
import { calculateChecksum } from '../utils/checksum';
import { toCanonical } from '../utils/paths';

export class YamlParser implements CodeParser {
    public supports(filePath: string): boolean {
        return filePath.endsWith('.yml') || filePath.endsWith('.yaml');
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const nodes: CodeNode[] = [];
        const edges: RawCodeEdge[] = [];
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const fileQname = toCanonical(filePath);
        const checksum = calculateChecksum(content);

        // File node
        nodes.push({
            qualified_name: fileQname,
            symbol_type: 'file',
            language: 'yaml',
            file_path: filePath,
            start_line: 1,
            end_line: lines.length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version,
            checksum,
            loc: lines.length
        });

        // Extract top-level keys (no leading whitespace, ends with ':')
        let inJobsSection = false;
        let jobIndent = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trimEnd();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const indent = line.length - line.trimStart().length;
            const keyMatch = trimmed.trimStart().match(/^([a-zA-Z0-9_\-]+)\s*:/);
            if (!keyMatch) continue;
            const keyName = keyMatch[1];

            if (indent === 0) {
                // Top-level key
                inJobsSection = (keyName === 'jobs');
                jobIndent = -1;
                nodes.push({
                    qualified_name: `${fileQname}#${keyName}`,
                    symbol_type: 'config_key',
                    language: 'yaml',
                    file_path: filePath,
                    start_line: i + 1,
                    end_line: i + 1,
                    visibility: 'public',
                    is_generated: false,
                    last_updated_commit: commit,
                    version
                });
                edges.push({ from_qname: fileQname, to_qname: `${fileQname}#${keyName}`, edge_type: 'contains', dynamic: false });
            } else if (inJobsSection && indent > 0) {
                // First level under jobs: = job names
                if (jobIndent === -1) jobIndent = indent;
                if (indent === jobIndent) {
                    nodes.push({
                        qualified_name: `${fileQname}#job:${keyName}`,
                        symbol_type: 'function',
                        language: 'yaml',
                        file_path: filePath,
                        start_line: i + 1,
                        end_line: i + 1,
                        visibility: 'public',
                        is_generated: false,
                        last_updated_commit: commit,
                        version
                    });
                    edges.push({ from_qname: fileQname, to_qname: `${fileQname}#job:${keyName}`, edge_type: 'contains', dynamic: false });
                }
            }
        }

        return { nodes, edges };
    }
}

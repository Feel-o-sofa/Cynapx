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

export class MarkdownParser implements CodeParser {
    public supports(filePath: string): boolean {
        return filePath.endsWith('.md') || filePath.endsWith('.mdx');
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const nodes: CodeNode[] = [];
        const edges: RawCodeEdge[] = [];
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const fileQname = toCanonical(filePath);

        nodes.push({
            qualified_name: fileQname,
            symbol_type: 'file',
            language: 'markdown',
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

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // H1 or H2 headers only
            const h1 = line.match(/^#\s+(.+)$/);
            const h2 = line.match(/^##\s+(.+)$/);
            const header = h1 || h2;
            if (!header) continue;
            const title = header[1].trim();
            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const qname = `${fileQname}#${slug}`;
            nodes.push({
                qualified_name: qname,
                symbol_type: 'section',
                language: 'markdown',
                file_path: filePath,
                start_line: i + 1,
                end_line: i + 1,
                visibility: 'public',
                is_generated: false,
                last_updated_commit: commit,
                version,
                signature: title
            });
            edges.push({ from_qname: fileQname, to_qname: qname, edge_type: 'contains' as const, dynamic: false });
        }

        return { nodes, edges };
    }
}

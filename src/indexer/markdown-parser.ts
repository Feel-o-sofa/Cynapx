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
            // Capture the section body: all lines until the next H1/H2 or EOF.
            const bodyLines: string[] = [];
            let j = i + 1;
            while (j < lines.length) {
                const nextLine = lines[j];
                if (nextLine.match(/^#{1,2}\s/)) break;  // stop at next H1/H2
                bodyLines.push(nextLine);
                j++;
            }
            const bodyText = bodyLines.join('\n').trim();

            nodes.push({
                qualified_name: qname,
                symbol_type: 'section',
                language: 'markdown',
                file_path: filePath,
                start_line: i + 1,
                end_line: j,  // section spans until the next header (or EOF)
                visibility: 'public',
                is_generated: false,
                last_updated_commit: commit,
                version,
                signature: title,
                // Store the non-empty body as docstring (max 2000 chars to avoid bloat)
                docstring: bodyText ? bodyText.slice(0, 2000) : undefined
            });
            edges.push({ from_qname: fileQname, to_qname: qname, edge_type: 'contains' as const, dynamic: false });
        }

        return { nodes, edges };
    }
}

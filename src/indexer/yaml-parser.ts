/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { CodeParser, DeltaGraph, RawCodeEdge } from './types';
import { CodeNode } from '../types';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { calculateChecksum } from '../utils/checksum';
import { toCanonical } from '../utils/paths';

/**
 * YamlParser: parses YAML config/workflow files into a node/edge delta.
 *
 * Uses js-yaml's `yaml.load()` to parse the full document into a real JS tree,
 * then walks that tree to extract:
 *   - one `config_key` node per top-level mapping key
 *   - one `function` node per `jobs.<id>` (GitHub Actions job)
 *   - `contains` edges from the file node to each of the above
 *
 * This replaces the previous hand-rolled line-by-line regex scan, which silently
 * mishandled flow-style mappings (`jobs: {build: ...}`), block scalars (`|`/`>`),
 * anchors/aliases (`&`/`*`), and tab indentation. The tree walk produces the same
 * node/edge set as the old parser on well-formed simple workflows, but is robust
 * to all of the above YAML styles.
 *
 * Graceful degradation: on a YAMLException (malformed YAML) we fall back to
 * emitting only the file-level node — the exception never propagates.
 *
 * Line numbers: js-yaml's `listener` option reports the 0-based line of each
 * `open` event. We record, for every mapping key encountered at parse time, the
 * line on which its key scalar began (keyed by the value node's identity so we can
 * look it up while walking the tree). For top-level keys this is exact; for job
 * keys it is the line of the job's value mapping. When a position cannot be
 * resolved (e.g. flow-style or alias-shared nodes), we approximate with line 1.
 */
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

        // File node — always emitted, even when the document fails to parse.
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

        // Line tracking via js-yaml's `listener` option. js-yaml v4 does not expose
        // per-node start marks on the State object, but on every `close` event the
        // node's `result` is fully constructed and `state.line` (0-based) holds the
        // line on which that node's token sits. For scalar keys this is exactly the
        // line of the key token (e.g. `jobs:` closes on the `jobs` line). We record
        // the first line observed for each distinct scalar string — top-level keys
        // and job ids are unique strings within a workflow, so a string->line map is
        // sufficient and reproduces the old line-based parser's positions exactly.
        //
        // Limitation: flow-style keys (`{build: ...}`) and alias-shared scalars are
        // collapsed onto their first textual occurrence; when a name is not seen as a
        // closed scalar at all we approximate with line 1 (top-level) or the parent
        // key's line (jobs). This is an acceptable approximation for these rare styles.
        const lineOfName = new Map<string, number>();
        const listener = (eventType: yaml.EventType, state: yaml.State): void => {
            if (eventType === 'close' && typeof state.result === 'string') {
                if (!lineOfName.has(state.result)) {
                    lineOfName.set(state.result, state.line + 1);
                }
            }
        };

        let doc: unknown;
        try {
            doc = yaml.load(content, { listener });
        } catch {
            // Malformed YAML (YAMLException) — emit only the file node, no throw.
            return { nodes, edges };
        }

        if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
            // Empty document or a non-mapping root (scalar / sequence): no keys.
            return { nodes, edges };
        }

        const root = doc as Record<string, unknown>;

        for (const keyName of Object.keys(root)) {
            const value = root[keyName];
            // Line of the key token, captured by the listener above. Falls back to
            // line 1 when the key was not observed as a closed scalar (flow style).
            const keyLine = lineOfName.get(keyName) ?? 1;
            const keyQname = `${fileQname}#${keyName}`;
            nodes.push({
                qualified_name: keyQname,
                symbol_type: 'config_key',
                language: 'yaml',
                file_path: filePath,
                start_line: keyLine,
                end_line: keyLine,
                visibility: 'public',
                is_generated: false,
                last_updated_commit: commit,
                version
            });
            edges.push({ from_qname: fileQname, to_qname: keyQname, edge_type: 'contains', dynamic: false });

            // GitHub Actions: extract `jobs.<id>` as function nodes.
            if (keyName === 'jobs' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
                const jobs = value as Record<string, unknown>;
                for (const jobId of Object.keys(jobs)) {
                    const jobVal = jobs[jobId];
                    const jobLine = lineOfName.get(jobId) ?? keyLine;
                    const jobQname = `${fileQname}#job:${jobId}`;
                    nodes.push({
                        qualified_name: jobQname,
                        symbol_type: 'function',
                        language: 'yaml',
                        file_path: filePath,
                        start_line: jobLine,
                        end_line: jobLine,
                        visibility: 'public',
                        is_generated: false,
                        last_updated_commit: commit,
                        version
                    });
                    edges.push({ from_qname: fileQname, to_qname: jobQname, edge_type: 'contains', dynamic: false });

                    // A-1(3): reusable workflow reference (`jobs.<id>.uses`) -> calls edge.
                    if (jobVal !== null && typeof jobVal === 'object' && !Array.isArray(jobVal)) {
                        const uses = (jobVal as Record<string, unknown>).uses;
                        if (typeof uses === 'string' && uses.length > 0) {
                            edges.push({ from_qname: jobQname, to_qname: uses, edge_type: 'calls', dynamic: false });
                        }
                    }
                }
            }
        }

        return { nodes, edges };
    }
}

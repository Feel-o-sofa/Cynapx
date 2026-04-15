/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import { GraphEngine } from './graph-engine';
import { CodeNode, CodeEdge } from '../types';

export interface ArchRule {
    name: string;
    from: string;  // layer name matched against file path segment
    to: string;    // layer name matched against file path segment
    allowed: boolean;
}

export interface ArchitecturePolicy {
    id: string;
    description: string;
    forbidden: {
        from: string; // e.g. "layer:data"
        to: string;   // e.g. "layer:api"
    }[];
}

export interface ArchitectureViolation {
    source: CodeNode;
    target: CodeNode;
    edge: CodeEdge;
    policyId: string;
    description: string;
}

/**
 * ArchitectureEngine detects violations of architectural policies.
 */
export class ArchitectureEngine {
    private cycleCache: { timestamp: number; cycles: number[][] } | null = null;
    private customRules: ArchRule[] | null = null;

    private policies: ArchitecturePolicy[] = [
        {
            id: 'layer-hierarchy',
            description: 'Maintain strict layer hierarchy (API -> Core -> Data)',
            forbidden: [
                { from: 'layer:data', to: 'layer:api' },
                { from: 'layer:data', to: 'layer:core' },
                { from: 'layer:core', to: 'layer:api' },
                { from: 'layer:utility', to: 'layer:api' },
                { from: 'layer:utility', to: 'layer:core' },
                { from: 'layer:utility', to: 'layer:data' }
            ]
        },
        {
            id: 'role-integrity',
            description: 'Ensure role-based relationship integrity',
            forbidden: [
                { from: 'role:utility', to: 'role:service' },
                { from: 'role:utility', to: 'role:repository' },
                { from: 'role:repository', to: 'role:service' }
            ]
        },
        {
            id: 'api-integrity',
            description: 'API layer should only be accessed by external entrypoints or tests',
            forbidden: [
                { from: 'layer:core', to: 'layer:api' },
                { from: 'layer:data', to: 'layer:api' }
            ]
        },
        {
            id: 'domain-isolation',
            description: 'Prevent direct cross-domain repository access without service mediation',
            forbidden: [
                { from: 'role:repository', to: 'role:repository' }
            ]
        }
    ];

    constructor(private graphEngine: GraphEngine) {}

    /**
     * Checks for architectural violations in the current knowledge graph.
     */
    public async checkViolations(): Promise<ArchitectureViolation[]> {
        const violations: ArchitectureViolation[] = [];
        const edges = this.graphEngine.getAllEdges();

        // 1. Policy-based violations
        for (const edge of edges) {
            // We only care about active dependency edges
            if (!['calls', 'dynamic_calls', 'inherits', 'implements', 'depends_on', 'reads', 'writes'].includes(edge.edge_type)) {
                continue;
            }

            const fromNode = this.graphEngine.getNodeById(edge.from_id);
            const toNode = this.graphEngine.getNodeById(edge.to_id);

            if (!fromNode || !toNode) continue;

            // [Phase 13] Contextual Filtering
            // 1. Ignore calls within the same file
            if (fromNode.file_path === toNode.file_path) continue;

            // 2. Ignore calls within the same class/object (shared prefix before #)
            const fromPrefix = fromNode.qualified_name.split('#')[0];
            const toPrefix = toNode.qualified_name.split('#')[0];
            if (fromPrefix === toPrefix) continue;

            for (const policy of this.policies) {
                // 3. Special handling for domain-isolation
                if (policy.id === 'domain-isolation' && this.hasTag(toNode, 'trait:internal')) {
                    continue;
                }

                for (const rule of policy.forbidden) {
                    if (this.hasTag(fromNode, rule.from) && this.hasTag(toNode, rule.to)) {
                        violations.push({
                            source: fromNode,
                            target: toNode,
                            edge: edge,
                            policyId: policy.id,
                            description: `Illegal relationship: ${rule.from} -> ${rule.to}`
                        });
                    }
                }
            }
        }

        // 2. Custom rule violations
        if (this.customRules !== null) {
            for (const edge of edges) {
                if (!['calls', 'depends_on', 'imports'].includes(edge.edge_type)) {
                    continue;
                }

                const fromNode = this.graphEngine.getNodeById(edge.from_id);
                const toNode = this.graphEngine.getNodeById(edge.to_id);

                if (!fromNode || !toNode) continue;
                if (fromNode.file_path === toNode.file_path) continue;

                for (const rule of this.customRules) {
                    if (rule.allowed) continue;

                    const fromPath = (fromNode.file_path ?? '').replace(/\\/g, '/');
                    const toPath = (toNode.file_path ?? '').replace(/\\/g, '/');

                    const fromSegments = fromPath.split('/');
                    const toSegments = toPath.split('/');

                    if (fromSegments.includes(rule.from) && toSegments.includes(rule.to)) {
                        violations.push({
                            source: fromNode,
                            target: toNode,
                            edge: edge,
                            policyId: `custom:${rule.name}`,
                            description: `Custom rule violation "${rule.name}": ${rule.from} -> ${rule.to} is not allowed`
                        });
                    }
                }
            }
        }

        // 3. Circular Dependency Detection
        const cycles = this.detectCycles();
        for (const cycle of cycles) {
            const source = this.graphEngine.getNodeById(cycle[0]);
            const target = this.graphEngine.getNodeById(cycle[1]);
            if (source && target) {
                // Check if we already reported this cycle to avoid redundancy
                const existing = violations.find(v => v.policyId === 'circular-dependency' && 
                    v.description.includes(source.qualified_name) && v.description.includes(target.qualified_name));
                
                if (!existing) {
                    violations.push({
                        source,
                        target,
                        edge: edges.find(e => e.from_id === cycle[0] && e.to_id === cycle[1])!,
                        policyId: 'circular-dependency',
                        description: `Circular dependency detected: ${cycle.map(id => this.graphEngine.getNodeById(id)?.qualified_name).join(' -> ')} -> ${source.qualified_name}`
                    });
                }
            }
        }

        return violations;
    }

    private detectCycles(): number[][] {
        // Return cached result if fresh (< 60 seconds)
        if (this.cycleCache && (Date.now() - this.cycleCache.timestamp < 60_000)) {
            return this.cycleCache.cycles;
        }

        const cycles: number[][] = [];
        const visited = new Set<number>();
        const allNodes = this.graphEngine.getAllNodes();

        // Iterative DFS replacing the former recursive findCycles.
        // Each stack frame is either an "enter" frame (visit the node) or an
        // "exit" frame (pop the node from recStack after all neighbours are done).
        type Frame =
            | { kind: 'enter'; nodeId: number; path: number[] }
            | { kind: 'exit';  nodeId: number };

        for (const node of allNodes) {
            if (node.id === undefined || visited.has(node.id)) continue;

            const recStack = new Set<number>();
            const stack: Frame[] = [{ kind: 'enter', nodeId: node.id, path: [] }];

            while (stack.length > 0) {
                const frame = stack.pop()!;

                if (frame.kind === 'exit') {
                    recStack.delete(frame.nodeId);
                    continue;
                }

                const { nodeId, path } = frame;

                if (visited.has(nodeId)) {
                    // Node was already fully processed in a previous iteration;
                    // we still need to check recStack for the cycle-detection
                    // path that led here, but since it is visited we just skip.
                    continue;
                }

                visited.add(nodeId);
                recStack.add(nodeId);
                const currentPath = [...path, nodeId];

                // Schedule the exit action so recStack is cleaned up after all
                // descendants of this node have been processed.
                stack.push({ kind: 'exit', nodeId });

                const outgoing = this.graphEngine.getOutgoingEdges(nodeId).filter(e =>
                    ['calls', 'dynamic_calls', 'inherits', 'implements', 'depends_on'].includes(e.edge_type)
                );

                for (const edge of outgoing) {
                    if (!visited.has(edge.to_id)) {
                        stack.push({ kind: 'enter', nodeId: edge.to_id, path: currentPath });
                    } else if (recStack.has(edge.to_id)) {
                        // Cycle found
                        const cycleStartIdx = currentPath.indexOf(edge.to_id);
                        if (cycleStartIdx !== -1) {
                            cycles.push(currentPath.slice(cycleStartIdx));
                        }
                    }
                }
            }
        }

        this.cycleCache = { timestamp: Date.now(), cycles };
        return cycles;
    }

    private hasTag(node: CodeNode, tag: string): boolean {
        if (!node.tags) return false;
        const lowerTag = tag.toLowerCase();
        return node.tags.some(t => t.toLowerCase() === lowerTag);
    }

    /**
     * Loads custom layer rules from a JSON file.
     * Throws if the file contains invalid JSON or is not an array.
     */
    public loadRules(rulesPath: string): void {
        let raw: string;
        try {
            raw = fs.readFileSync(rulesPath, 'utf-8');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`arch-rules.json: failed to read file at '${rulesPath}': ${msg}`);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`arch-rules.json: invalid JSON in '${rulesPath}': ${msg}`);
        }

        if (!Array.isArray(parsed)) {
            throw new Error(`arch-rules.json: expected a JSON array in '${rulesPath}', got ${typeof parsed}`);
        }

        this.customRules = parsed as ArchRule[];
    }

    /**
     * Returns true if custom rules have been loaded.
     */
    public get hasCustomRules(): boolean {
        return this.customRules !== null;
    }

    /**
     * Adds a custom policy.
     */
    public addPolicy(policy: ArchitecturePolicy): void {
        this.policies.push(policy);
    }
}

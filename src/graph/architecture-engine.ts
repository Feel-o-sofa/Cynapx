/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { GraphEngine } from './graph-engine';
import { CodeNode, CodeEdge } from '../types';

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

            for (const policy of this.policies) {
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

        // 2. Circular Dependency Detection
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
        const cycles: number[][] = [];
        const visited = new Set<number>();
        const recStack = new Set<number>();
        const allNodes = this.graphEngine.getAllNodes();

        const findCycles = (nodeId: number, path: number[]) => {
            visited.add(nodeId);
            recStack.add(nodeId);
            path.push(nodeId);

            const outgoing = this.graphEngine.getOutgoingEdges(nodeId).filter(e => 
                ['calls', 'dynamic_calls', 'inherits', 'implements', 'depends_on'].includes(e.edge_type)
            );

            for (const edge of outgoing) {
                if (!visited.has(edge.to_id)) {
                    findCycles(edge.to_id, [...path]);
                } else if (recStack.has(edge.to_id)) {
                    // Cycle found
                    const cycleStartIdx = path.indexOf(edge.to_id);
                    if (cycleStartIdx !== -1) {
                        cycles.push(path.slice(cycleStartIdx));
                    }
                }
            }

            recStack.delete(nodeId);
        };

        for (const node of allNodes) {
            if (node.id !== undefined && !visited.has(node.id)) {
                findCycles(node.id, []);
            }
        }

        return cycles;
    }

    private hasTag(node: CodeNode, tag: string): boolean {
        return !!node.tags && node.tags.includes(tag);
    }

    /**
     * Adds a custom policy.
     */
    public addPolicy(policy: ArchitecturePolicy): void {
        this.policies.push(policy);
    }
}

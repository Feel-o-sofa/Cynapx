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
        }
    ];

    constructor(private graphEngine: GraphEngine) {}

    /**
     * Checks for architectural violations in the current knowledge graph.
     */
    public async checkViolations(): Promise<ArchitectureViolation[]> {
        const violations: ArchitectureViolation[] = [];
        const edges = this.graphEngine.getAllEdges();

        for (const edge of edges) {
            // We only care about active dependency edges like 'calls', 'inherits', 'implements', 'depends_on'
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

        return violations;
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

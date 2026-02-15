/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { GraphEngine } from './graph-engine';

export interface LatentPolicy {
    fromTag: string;
    toTag: string;
    occurrence: number;
    probability: number;
    description: string;
}

/**
 * PolicyDiscoverer detects implicit architectural patterns using statistical analysis.
 */
export class PolicyDiscoverer {
    constructor(private graphEngine: GraphEngine) {}

    /**
     * Discovers latent policies by analyzing tag relationships.
     */
    public async discoverPolicies(threshold: number = 0.9, minCount: number = 5): Promise<LatentPolicy[]> {
        const edges = this.graphEngine.getAllEdges();
        const tagRelationships = new Map<string, Map<string, number>>();
        const tagCounts = new Map<string, number>();

        for (const edge of edges) {
            // Only consider dependency edges
            if (!['calls', 'dynamic_calls', 'inherits', 'implements', 'depends_on'].includes(edge.edge_type)) {
                continue;
            }

            const fromNode = this.graphEngine.getNodeById(edge.from_id);
            const toNode = this.graphEngine.getNodeById(edge.to_id);

            if (!fromNode || !toNode || !fromNode.tags || !toNode.tags) continue;

            for (const fTag of fromNode.tags) {
                // Increment source tag count
                tagCounts.set(fTag, (tagCounts.get(fTag) || 0) + 1);

                for (const tTag of toNode.tags) {
                    if (!tagRelationships.has(fTag)) {
                        tagRelationships.set(fTag, new Map());
                    }
                    const targets = tagRelationships.get(fTag)!;
                    targets.set(tTag, (targets.get(tTag) || 0) + 1);
                }
            }
        }

        const policies: LatentPolicy[] = [];

        for (const [fromTag, targets] of tagRelationships.entries()) {
            const totalOut = tagCounts.get(fromTag) || 0;
            if (totalOut < minCount) continue;

            for (const [toTag, count] of targets.entries()) {
                const prob = count / totalOut;
                if (prob >= threshold && count >= minCount) {
                    policies.push({
                        fromTag,
                        toTag,
                        occurrence: count,
                        probability: prob,
                        description: `Implicit Policy: Components tagged '${fromTag}' consistently depend on '${toTag}' (${(prob * 100).toFixed(1)}% of cases).`
                    });
                }
            }
        }

        return policies;
    }
}

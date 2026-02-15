/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { GraphEngine, TraversalResult } from './graph-engine';
import { CodeNode } from '../types';

export type RefactorRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RefactoringProposal {
    symbol: string;
    risk: RefactorRisk;
    impactedNodeCount: number;
    reasons: string[];
    steps: string[];
}

/**
 * RefactoringEngine calculates the risk and safe paths for refactoring symbols.
 */
export class RefactoringEngine {
    constructor(private graphEngine: GraphEngine) {}

    /**
     * Proposes a refactoring plan for a given symbol.
     */
    public async proposeRefactor(qualifiedName: string): Promise<RefactoringProposal | null> {
        const node = this.graphEngine.getNodeByQualifiedName(qualifiedName);
        if (!node || node.id === undefined) return null;

        const impact = this.graphEngine.traverse(node.id, 'BFS', {
            direction: 'incoming',
            maxDepth: 5,
            useCache: true
        });

        const risk = this.calculateRisk(node, impact);
        const reasons = this.getRiskReasons(node, impact);
        const steps = this.generateSteps(node, impact, risk);

        return {
            symbol: qualifiedName,
            risk,
            impactedNodeCount: impact.length,
            reasons,
            steps
        };
    }

    private calculateRisk(node: CodeNode, impact: TraversalResult[]): RefactorRisk {
        const fanIn = node.fan_in || 0;
        const complexity = node.cyclomatic || 0;
        const impactedCount = impact.length;

        if (fanIn >= 50 || complexity >= 30 || impactedCount >= 100) return 'CRITICAL';
        if (fanIn >= 20 || complexity >= 15 || impactedCount >= 30) return 'HIGH';
        if (fanIn >= 5 || complexity >= 8 || impactedCount >= 10) return 'MEDIUM';
        return 'LOW';
    }

    private getRiskReasons(node: CodeNode, impact: TraversalResult[]): string[] {
        const reasons: string[] = [];
        if ((node.fan_in || 0) > 20) reasons.push(`High coupling: ${node.fan_in} incoming dependencies.`);
        if ((node.cyclomatic || 0) > 15) reasons.push(`High complexity: Cyclomatic complexity is ${node.cyclomatic}.`);
        if (impact.length > 30) reasons.push(`Broad impact: ${impact.length} symbols are transitively affected.`);
        
        if (node.tags?.includes('trait:entrypoint')) reasons.push('System entrypoint: Modification may affect overall startup or lifecycle.');
        if (node.tags?.includes('layer:core')) reasons.push('Core layer symbol: Fundamental logic component.');
        if (node.tags?.includes('layer:data')) reasons.push('Data layer symbol: Affects persistence and schema integrity.');

        if (reasons.length === 0) reasons.push('Low complexity and coupling.');
        return reasons;
    }

    private generateSteps(node: CodeNode, impact: TraversalResult[], risk: RefactorRisk): string[] {
        const steps: string[] = [
            `1. [Investigation] Review the detailed impact map for ${node.qualified_name}.`,
        ];

        if (risk === 'CRITICAL' || risk === 'HIGH') {
            steps.push(`2. [Abstraction] Introduce an interface or abstract class to decouple ${node.qualified_name} from its callers.`);
            steps.push(`3. [Incremental] Apply changes using the "Branch by Abstraction" pattern.`);
        } else if (risk === 'MEDIUM') {
            steps.push(`2. [Preparation] Ensure unit tests cover all direct callers (${node.fan_in} nodes).`);
        }

        steps.push(`4. [Verification] Run full integration tests, focusing on: ${impact.slice(0, 3).map(i => i.node.qualified_name).join(', ')}...`);
        steps.push(`5. [Cleanup] Update documentation and historical context via 'backfill_history'.`);

        return steps;
    }
}

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

export function mergeResultsRRF(keywordNodes: any[], vectorNodes: any[], limit: number): any[] {
    const k = 60;
    const scores = new Map<number, number>();
    const nodeMap = new Map<number, any>();
    const applyRRF = (nodes: any[]) => {
        nodes.forEach((node, rank) => {
            const id = node.id!;
            nodeMap.set(id, node);
            scores.set(id, (scores.get(id) || 0) + (1 / (k + rank + 1)));
        });
    };
    applyRRF(keywordNodes);
    applyRRF(vectorNodes);
    return Array.from(scores.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => nodeMap.get(id));
}

export function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escapeDot(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { EngineContext } from '../workspace-manager.js';

/**
 * H-1: Thrown by requireEngine() when a tool handler is invoked before the
 * relevant engine component has been constructed (e.g. during the brief
 * window between Host promotion and startHostServices() completing). The
 * tool dispatcher converts this into an `isError` ToolResult instead of
 * letting a TypeError on `undefined` crash the request.
 */
export class EngineNotReadyError extends Error {
    constructor(public readonly field: string) {
        super(`Engine component '${field}' is not ready yet — the host is still initializing. Please retry shortly.`);
        this.name = 'EngineNotReadyError';
    }
}

/**
 * Returns `ctx[key]`, throwing EngineNotReadyError if it hasn't been
 * initialized yet. Replaces unsafe `ctx.xxx!` non-null assertions in tool
 * handlers.
 */
export function requireEngine<K extends keyof EngineContext>(ctx: EngineContext, key: K): NonNullable<EngineContext[K]> {
    const value = ctx[key];
    if (value === undefined || value === null) {
        throw new EngineNotReadyError(String(key));
    }
    return value as NonNullable<EngineContext[K]>;
}

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

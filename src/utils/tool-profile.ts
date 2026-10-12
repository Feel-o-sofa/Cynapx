/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Logger } from './logger';

const log = new Logger('ToolProfile');

/**
 * Which toolset a Cynapx process exposes to its MCP clients.
 *
 * - `frontier` (default): tuned for frontier-class agents. Tools that compete
 *   with what such an agent already does well on its own (semantic similarity,
 *   prescriptive refactoring, pattern discovery) are hidden, and embeddings are
 *   off unless explicitly configured. Cynapx focuses on what the agent cannot
 *   do: cross-session memory, symbol history, declared-architecture checks,
 *   reverse call relationships and deterministic metrics.
 * - `full`: every tool, with the Python embedding sidecar as the default
 *   provider. Intended for smaller local models that benefit from them.
 *
 * Nothing is deleted under `frontier`; hidden tools keep their code and tests
 * and come back with `CYNAPX_TOOL_PROFILE=full`.
 */
export type ToolProfile = 'frontier' | 'full';

export const DEFAULT_TOOL_PROFILE: ToolProfile = 'frontier';

export const FRONTIER_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
    'find_similar_symbols',
    'propose_refactor',
    'discover_latent_policies',
    'export_graph',
    're_tag_project',
    'get_remediation_strategy',
]);

export const FRONTIER_HIDDEN_PROMPTS: ReadonlySet<string> = new Set([
    'find-similar',
]);

/**
 * Resolves the profile from `CYNAPX_TOOL_PROFILE`. The profile is per process:
 * an MCP client fetches the tool list once at connect time, so it cannot follow
 * the active project. Per-project choice is made in the client's server config
 * (its `env` block), which starts one process per project anyway.
 */
export function resolveToolProfile(env: NodeJS.ProcessEnv = process.env): ToolProfile {
    const raw = env.CYNAPX_TOOL_PROFILE?.trim().toLowerCase();
    if (!raw) return DEFAULT_TOOL_PROFILE;
    if (raw === 'frontier' || raw === 'full') return raw;
    log.warn(`Unknown CYNAPX_TOOL_PROFILE "${env.CYNAPX_TOOL_PROFILE}" — using "${DEFAULT_TOOL_PROFILE}". Valid values: frontier, full.`);
    return DEFAULT_TOOL_PROFILE;
}

export function isToolEnabled(name: string, profile: ToolProfile): boolean {
    return profile === 'full' || !FRONTIER_HIDDEN_TOOLS.has(name);
}

export function isPromptEnabled(name: string, profile: ToolProfile): boolean {
    return profile === 'full' || !FRONTIER_HIDDEN_PROMPTS.has(name);
}

/** Explanation returned when a client calls a tool its profile hides. */
export function disabledToolMessage(name: string, profile: ToolProfile): string {
    return `Tool '${name}' is disabled under the '${profile}' tool profile, which is tuned for ` +
        `frontier-class agents. Restart the Cynapx server with CYNAPX_TOOL_PROFILE=full to enable it ` +
        `(intended for smaller local models).`;
}

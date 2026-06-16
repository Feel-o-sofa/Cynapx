/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Server as SdkMcpServer } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError
} from "@modelcontextprotocol/sdk/types.js";
import { EngineContext, WorkspaceManager } from './workspace-manager.js';
import { EmbeddingProvider } from '../indexer/embedding-manager.js';
import { RemediationEngine } from '../graph/remediation-engine.js';
import { IpcCoordinator } from './ipc-coordinator.js';
import { toolRegistry } from './tools/_registry.js';
import { EngineNotReadyError } from './tools/_utils.js';
import { ProgressReporter, NOOP_PROGRESS, createProgressReporter } from './tools/_progress.js';

export interface ToolDeps {
    waitUntilReady: () => Promise<void>;
    getContext: () => EngineContext;
    isTerminal: () => boolean;
    getTerminalCoordinator: () => IpcCoordinator | undefined;
    embeddingProvider: EmbeddingProvider;
    workspaceManager: WorkspaceManager;
    remediationEngine: RemediationEngine;
    onInitialize?: (targetPath: string) => Promise<void>;
    onPurge?: (hash: string) => Promise<void>;
    markReady: (state: boolean) => void;
    getIsInitialized: () => boolean;
    setIsInitialized: (value: boolean) => void;
}

export function registerToolHandlers(sdkServer: SdkMcpServer, deps: ToolDeps): void {
    sdkServer.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: "get_setup_context",
                description: "Get project initialization status and registry info.",
                inputSchema: { type: "object", properties: {} }
            },
            {
                name: "get_project_overview",
                description: "Returns a token-efficient briefing of the indexed project: purpose, tech stack, architecture shape, entry points, hotspots, and documentation headers. Call this first when starting work on an unfamiliar codebase.",
                inputSchema: {
                    type: "object",
                    properties: {
                        include_clusters: { type: "boolean", default: true }
                    }
                }
            },
            {
                name: "initialize_project",
                description: "Initialize and register a project in the central registry.",
                inputSchema: {
                    type: "object",
                    properties: {
                        mode: { type: "string", enum: ["current", "existing", "custom"] },
                        path: { type: "string" },
                        zero_pollution: { type: "boolean", default: true }
                    },
                    required: ["mode"]
                }
            },
            {
                name: "search_symbols",
                description: "Search for symbols with semantic support.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string" },
                        semantic: { type: "boolean" },
                        limit: { type: "number" },
                        symbol_type: { type: "string" }
                    },
                    required: ["query"]
                }
            },
            {
                name: "get_symbol_details",
                description: "Get comprehensive details, metrics, and pruned source code for a symbol.",
                inputSchema: {
                    type: "object",
                    properties: {
                        qualified_name: { type: "string" },
                        include_source: { type: "boolean", default: true },
                        summary_only: { type: "boolean", default: false }
                    },
                    required: ["qualified_name"]
                }
            },
            {
                name: "analyze_impact",
                description: "Identify all symbols that depend on this symbol (ripple effect).",
                inputSchema: {
                    type: "object",
                    properties: {
                        qualified_name: { type: "string" },
                        max_depth: { type: "number", default: 3 },
                        use_cache: { type: "boolean", default: true }
                    },
                    required: ["qualified_name"]
                }
            },
            {
                name: "get_callers",
                description: "Get direct callers of a symbol.",
                inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
            },
            {
                name: "get_callees",
                description: "Get symbols called by a symbol.",
                inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
            },
            {
                name: "get_related_tests",
                description: "Find associated test symbols for a production symbol.",
                inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
            },
            {
                name: "check_architecture_violations",
                description: "Detect layer or role violations in the codebase.",
                inputSchema: { type: "object", properties: {} }
            },
            {
                name: "get_remediation_strategy",
                description: "Get structural guidance for fixing violations.",
                inputSchema: { type: "object", properties: { violation: { type: "object" } }, required: ["violation"] }
            },
            {
                name: "propose_refactor",
                description: "Get a risk-aware refactoring proposal.",
                inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
            },
            {
                name: "get_risk_profile",
                description: "Calculate risk profile based on CC, churn and coupling.",
                inputSchema: { type: "object", properties: { qualified_name: { type: "string" } }, required: ["qualified_name"] }
            },
            {
                name: "get_hotspots",
                description: "Identify technical debt hotspots via specific metrics.",
                inputSchema: {
                    type: "object",
                    properties: {
                        metric: { type: "string", enum: ["cyclomatic", "fan_in", "fan_out", "loc"] },
                        threshold: { type: "number", default: 0 }
                    },
                    required: ["metric"]
                }
            },
            {
                name: "find_dead_code",
                description: "Identify unreachable or unused symbols.",
                inputSchema: { type: "object", properties: {} }
            },
            {
                name: "export_graph",
                description: "Export the dependency graph. Supports json (Mermaid summary), graphml, and dot formats.",
                inputSchema: {
                    type: "object",
                    properties: {
                        root_qname: { type: "string" },
                        max_depth: { type: "number", default: 2 },
                        format: { type: "string", enum: ["json", "graphml", "dot"], default: "json" }
                    }
                }
            },
            {
                name: "check_consistency",
                description: "Verify graph integrity against disk and Git.",
                inputSchema: {
                    type: "object",
                    properties: {
                        repair: { type: "boolean", default: false },
                        force: { type: "boolean", default: false }
                    }
                }
            },
            {
                name: "purge_index",
                description: "Completely delete local database index.",
                inputSchema: {
                    type: "object",
                    properties: {
                        confirm: { type: "boolean" },
                        unregister: { type: "boolean" }
                    },
                    required: ["confirm"]
                }
            },
            {
                name: "re_tag_project",
                description: "Re-run structural characteristic tagging.",
                inputSchema: { type: "object", properties: {} }
            },
            {
                name: "backfill_history",
                description: "Fetch and map Git commit history.",
                inputSchema: { type: "object", properties: {} }
            },
            {
                name: "discover_latent_policies",
                description: "Discover implicit architectural patterns.",
                inputSchema: {
                    type: "object",
                    properties: {
                        threshold: { type: "number", default: 0.9 },
                        min_count: { type: "number", default: 5 }
                    }
                }
            }
        ]
    }));

    sdkServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        // A-4 (Phase 14-5): emit notifications/progress only when the caller
        // opted in via `_meta.progressToken` on the originating request. The
        // SDK's request-scoped `extra.sendNotification` correlates the progress
        // notification with this request. When no token is present we pass a
        // no-op reporter so handlers can call report() unconditionally.
        //
        // M-1 (Phase 15-3) — spec tracking. The 2026-07-28 spec RC demotes Tasks
        // (SEP-1686) from core to an extension (server-directed handle returned
        // from this `tools/call` response, then `tasks/get`/`update`/`cancel`;
        // `tasks/list` removed). The progress-token opt-in used here is RETAINED
        // in the RC and is NOT deprecated, so this wiring stays compatible. Full
        // task-lifecycle adoption is DEFERRED until SDK v2 stable. See
        // src/server/tools/_progress.ts for refs (RC blog, SEP-1686, sdk#2042).
        const progressToken = request.params?._meta?.progressToken;
        const progress = createProgressReporter(
            progressToken,
            extra.sendNotification as Parameters<typeof createProgressReporter>[1]
        );
        return executeTool(request.params.name, request.params.arguments, deps, progress);
    });
}

export async function executeTool(
    name: string,
    args: any,
    deps: ToolDeps,
    progress: ProgressReporter = NOOP_PROGRESS
): Promise<any> {
    if (deps.isTerminal() && deps.getTerminalCoordinator()) {
        // A-4(2): progress is not relayed across the Host↔Terminal IPC boundary
        // (see ipc-coordinator.ts) — Terminal-forwarded tools report no progress.
        return deps.getTerminalCoordinator()!.forwardExecuteTool(name, args);
    }
    await deps.waitUntilReady();

    const handler = toolRegistry.get(name);
    if (!handler) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    try {
        return await handler.execute(args, deps, progress);
    } catch (err) {
        // H-1: the active project's engine context can briefly be incomplete
        // right after Host promotion, before startHostServices() finishes.
        // Surface this as a retryable tool error instead of crashing.
        if (err instanceof EngineNotReadyError) {
            return { isError: true, content: [{ type: 'text', text: err.message }] };
        }
        throw err;
    }
}

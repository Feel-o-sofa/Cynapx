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

export interface ToolDeps {
    waitUntilReady: () => Promise<void>;
    getContext: () => EngineContext;
    isTerminal: () => boolean;
    getTerminalCoordinator: () => IpcCoordinator | undefined;
    embeddingProvider: EmbeddingProvider;
    workspaceManager: WorkspaceManager;
    remediationEngine: RemediationEngine;
    onInitialize?: (targetPath: string) => Promise<void>;
    onPurge?: () => Promise<void>;
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

    sdkServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        return executeTool(request.params.name, request.params.arguments, deps);
    });
}

export async function executeTool(name: string, args: any, deps: ToolDeps): Promise<any> {
    if (deps.isTerminal() && deps.getTerminalCoordinator()) {
        return deps.getTerminalCoordinator()!.forwardExecuteTool(name, args);
    }
    await deps.waitUntilReady();

    const handler = toolRegistry.get(name);
    if (!handler) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    return handler.execute(args, deps);
}

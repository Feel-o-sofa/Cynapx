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
import * as path from 'path';
import * as fs from 'fs';
import { EngineContext, WorkspaceManager } from './workspace-manager.js';
import { EmbeddingProvider } from '../indexer/embedding-manager.js';
import { RemediationEngine } from '../graph/remediation-engine.js';
import { IpcCoordinator } from './ipc-coordinator.js';
import { ConsistencyChecker } from '../indexer/consistency-checker.js';
import { addToRegistry, getDatabasePath, readRegistry, removeFromRegistry, ANCHOR_FILE } from '../utils/paths.js';

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
                description: "Generate Mermaid visualization and structural summary.",
                inputSchema: {
                    type: "object",
                    properties: {
                        root_qname: { type: "string" },
                        max_depth: { type: "number", default: 2 }
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

    switch (name) {
        case 'get_setup_context': {
            const registry = readRegistry();
            return { content: [{ type: "text", text: JSON.stringify({ status: deps.getIsInitialized() ? "ALREADY_INITIALIZED" : "INITIALIZATION_REQUIRED", current_path: process.cwd(), registered_projects: registry }, null, 2) }] };
        }
        case 'initialize_project': {
            let target = args.path ? path.resolve(args.path) : process.cwd();
            if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
            if (!args.zero_pollution) fs.writeFileSync(path.join(target, ANCHOR_FILE), JSON.stringify({ created_at: new Date().toISOString() }));
            addToRegistry(target);
            if (deps.onInitialize) await deps.onInitialize(target);
            deps.markReady(true);
            return { content: [{ type: "text", text: `Successfully initialized project at ${target}. Analysis engine is now active.` }] };
        }
        case 'search_symbols': {
            const limit = args.limit || 10;
            const results = await Promise.all(deps.workspaceManager.getAllContexts().map(async (ctx) => {
                const keywordNodes = ctx.graphEngine!.nodeRepo.searchSymbols(args.query, limit, { symbol_type: args.symbol_type });
                if (!args.semantic) return keywordNodes;
                try {
                    const queryVector = await deps.embeddingProvider.generate(args.query);
                    const vectorResults = ctx.vectorRepo!.search(queryVector, limit);
                    const vectorNodes = vectorResults.map(r => ctx.graphEngine!.getNodeById(r.id)).filter(n => n !== null);
                    return mergeResultsRRF(keywordNodes, vectorNodes, limit);
                } catch { return keywordNodes; }
            }));
            const flat = results.flat().slice(0, limit);
            return { content: [{ type: "text", text: JSON.stringify(flat.map(n => ({ qname: n.qualified_name, type: n.symbol_type, file: n.file_path, tags: n.tags })), null, 2) }] };
        }
        case 'get_symbol_details': {
            const ctx = deps.getContext();
            const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };

            if (args.summary_only) return { content: [{ type: "text", text: JSON.stringify({ qname: node.qualified_name, type: node.symbol_type, metrics: { loc: node.loc, cyclomatic: node.cyclomatic, fan_in: node.fan_in, fan_out: node.fan_out } }, null, 2) }] };

            let text = `### Symbol: ${node.qualified_name}\n`;
            text += `- **Type**: ${node.symbol_type}\n`;
            if (node.signature) text += `- **Signature**: ${node.signature}\n`;
            text += `- **File**: ${node.file_path} (line ${node.start_line}-${node.end_line})\n`;

            if (node.tags && node.tags.length > 0) {
                text += `- **Structural Tags**: ${Array.isArray(node.tags) ? node.tags.map(t => `${t}`).join(', ') : node.tags}\n`;
            }

            if (node.history && node.history.length > 0) {
                text += `\n#### Historical Evidence:\n`;
                node.history.slice(0, 3).forEach(commit => {
                    text += `- **[${commit.hash.substring(0, 7)}]** ${commit.message} (by ${commit.author})\n`;
                });
            }

            text += `\n#### Metrics:\n- LOC: ${node.loc}, CC: ${node.cyclomatic}\n- Static Coupling: Fan-in: ${node.fan_in || 0}, Fan-out: ${node.fan_out || 0}\n`;

            if (args.include_source !== false) {
                try {
                    const security = ctx.securityProvider;
                    if (security) security.validatePath(node.file_path);
                    const content = fs.readFileSync(node.file_path, 'utf8').split('\n');
                    const snippet = content.slice(node.start_line - 1, node.end_line);
                    const display = snippet.length > 100 ?
                        snippet.slice(0, 50).join('\n') + "\n\n// ... [Truncated for Token Optimization: Use read_file for full content] ..." :
                        snippet.join('\n');
                    text += '\n#### Source Code Snippet:\n```\n' + display + '\n```\n';
                } catch (e) { text += `\n> [!WARNING] Source unavailable: ${e}`; }
            }
            return { content: [{ type: "text", text }] };
        }
        case 'analyze_impact': {
            const ctx = deps.getContext();
            const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
            const results = ctx.graphEngine!.traverse(node.id!, 'BFS', { direction: 'incoming', maxDepth: args.max_depth || 3, useCache: args.use_cache });
            const formatted = results.map(r => ({
                node: r.node.qualified_name,
                distance: r.distance,
                impact_path: r.path.map(step => ctx.graphEngine!.getNodeById(step.nodeId)?.qualified_name).reverse().join(' -> ')
            }));
            return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
        }
        case 'get_callers': {
            const ctx = deps.getContext();
            const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
            const callers = ctx.graphEngine!.getIncomingEdges(node.id!).map(e => ({ qname: ctx.graphEngine!.getNodeById(e.from_id)?.qualified_name, line: e.call_site_line }));
            return { content: [{ type: "text", text: JSON.stringify(callers, null, 2) }] };
        }
        case 'get_callees': {
            const ctx = deps.getContext();
            const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
            const callees = ctx.graphEngine!.getOutgoingEdges(node.id!).map(e => ({ qname: ctx.graphEngine!.getNodeById(e.to_id)?.qualified_name, line: e.call_site_line }));
            return { content: [{ type: "text", text: JSON.stringify(callees, null, 2) }] };
        }
        case 'get_related_tests': {
            const ctx = deps.getContext();
            const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
            const tests = ctx.graphEngine!.getIncomingEdges(node.id!).filter(e => e.edge_type === 'tests').map(e => ctx.graphEngine!.getNodeById(e.from_id)?.qualified_name);
            return { content: [{ type: "text", text: JSON.stringify(tests, null, 2) }] };
        }
        case 'check_architecture_violations': {
            const violations = await deps.getContext().archEngine!.checkViolations();
            return { content: [{ type: "text", text: JSON.stringify(violations, null, 2) }] };
        }
        case 'get_remediation_strategy': {
            if (!args.violation) {
                return { isError: true, content: [{ type: "text", text: "Missing required argument: violation" }] };
            }
            if (!args.violation.source || !args.violation.target) {
                return { isError: true, content: [{ type: "text", text: "Invalid violation object: 'source' and 'target' nodes are required. Pass a violation object returned by check_architecture_violations." }] };
            }
            const strategy = deps.remediationEngine.getRemediationStrategy(args.violation);
            return { content: [{ type: "text", text: JSON.stringify(strategy, null, 2) }] };
        }
        case 'propose_refactor': {
            const proposal = await deps.getContext().refactorEngine!.proposeRefactor(args.qualified_name);
            return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
        }
        case 'get_risk_profile': {
            const profile = await deps.getContext().refactorEngine!.getRiskProfile(args.qualified_name);
            return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
        }
        case 'get_hotspots': {
            const ALLOWED_METRICS = ['cyclomatic', 'fan_in', 'fan_out', 'loc'] as const;
            type AllowedMetric = typeof ALLOWED_METRICS[number];
            if (!ALLOWED_METRICS.includes(args.metric as AllowedMetric)) {
                return { isError: true, content: [{ type: 'text', text: `Invalid metric '${args.metric}'. Allowed values: ${ALLOWED_METRICS.join(', ')}` }] };
            }
            const ctx = deps.getContext();
            const db = ctx.dbManager!.getDb();
            const hotspots = db.prepare(`SELECT qualified_name, symbol_type, ${args.metric} FROM nodes WHERE ${args.metric} >= ? ORDER BY ${args.metric} DESC LIMIT 20`).all(args.threshold || 0);
            return { content: [{ type: "text", text: JSON.stringify(hotspots, null, 2) }] };
        }
        case 'find_dead_code': {
            const report = await deps.getContext().optEngine!.findDeadCode();
            const totalDead = report.summary.deadSymbols;
            let text = `Found ${totalDead} potential dead code symbols:\n`;
            text += `- HIGH confidence (private, fan_in=0): ${report.summary.highConfidenceDead} symbols\n`;
            text += `- MEDIUM confidence (public, trait:internal, fan_in=0): ${report.summary.mediumConfidenceDead} symbols\n`;
            text += `- LOW confidence (public, fan_in=0, may be external API): ${report.summary.lowConfidenceDead} symbols\n`;
            text += `\nTotal symbols analyzed: ${report.summary.totalSymbols} | Optimization potential: ${report.summary.optimizationPotential}\n`;

            if (report.high.length > 0) {
                text += `\nHIGH confidence (review first):\n`;
                report.high.forEach(node => {
                    text += `  - ${node.qualified_name} [${node.symbol_type}] (${node.file_path}:${node.start_line})\n`;
                });
            }

            if (report.medium.length > 0) {
                text += `\nMEDIUM confidence:\n`;
                report.medium.forEach(node => {
                    text += `  - ${node.qualified_name} [${node.symbol_type}] (${node.file_path}:${node.start_line})\n`;
                });
            }

            // LOW confidence: count only, list omitted (high FP rate)
            if (report.low.length > 0) {
                text += `\nLOW confidence: ${report.low.length} symbols (list omitted — high false-positive rate, likely external API surface)\n`;
            }

            return { content: [{ type: "text", text }] };
        }
        case 'export_graph': {
            const ctx = deps.getContext();
            const mermaid = await ctx.graphEngine!.exportToMermaid({ rootQName: args.root_qname, maxDepth: args.max_depth || 2 });
            const data = await ctx.graphEngine!.getGraphData({ rootQName: args.root_qname, maxDepth: args.max_depth || 2 });
            const summary = `### Graph Export: ${args.root_qname || 'Root'}\n- Nodes: ${data.nodes.length}\n- Edges: ${data.edges.length}\n\n${mermaid}\n`;
            return { content: [{ type: "text", text: summary }] };
        }
        case 'check_consistency': {
            const ctx = deps.getContext();
            const checker = new ConsistencyChecker(ctx.graphEngine!.nodeRepo, ctx.gitService!, ctx.updatePipeline!, ctx.projectPath);
            const results = await checker.validate(args.repair, args.force);
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }
        case 'purge_index': {
            if (!args.confirm) return { content: [{ type: "text", text: "WARNING: This deletes all index data. Confirm with 'confirm: true'" }] };
            const ctx = deps.getContext();
            const dbPath = getDatabasePath(ctx.projectPath);
            if (deps.onPurge) await deps.onPurge();
            ctx.dbManager?.dispose();
            deps.setIsInitialized(false);
            [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
            if (args.unregister) removeFromRegistry(ctx.projectPath);
            return { content: [{ type: "text", text: "Project index purged successfully. Server in PENDING mode." }] };
        }
        case 're_tag_project': {
            const pipeline = deps.getContext().updatePipeline!;
            await pipeline.reTagAllNodes();
            return { content: [{ type: "text", text: "Successfully re-tagged all nodes." }] };
        }
        case 'backfill_history': {
            const pipeline = deps.getContext().updatePipeline!;
            await pipeline.mapHistoryToProject();
            return { content: [{ type: "text", text: "Successfully backfilled Git history." }] };
        }
        case 'discover_latent_policies': {
            const policies = await deps.getContext().policyDiscoverer!.discoverPolicies(args.threshold, args.min_count);
            return { content: [{ type: "text", text: JSON.stringify(policies, null, 2) }] };
        }
        default: throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
}

function mergeResultsRRF(keywordNodes: any[], vectorNodes: any[], limit: number): any[] {
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

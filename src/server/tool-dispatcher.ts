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
import * as os from 'os';
import { EngineContext, WorkspaceManager } from './workspace-manager.js';
import { EmbeddingProvider } from '../indexer/embedding-manager.js';
import { RemediationEngine } from '../graph/remediation-engine.js';
import { IpcCoordinator } from './ipc-coordinator.js';
import { ConsistencyChecker } from '../indexer/consistency-checker.js';
import { addToRegistry, getDatabasePath, getProjectHash, readRegistry, removeFromRegistry, ANCHOR_FILE, toCanonical } from '../utils/paths.js';

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

// H-6: Module-level mutex flag to prevent concurrent initialization across sessions
let initializationInProgress = false;

export async function executeTool(name: string, args: any, deps: ToolDeps): Promise<any> {
    if (deps.isTerminal() && deps.getTerminalCoordinator()) {
        return deps.getTerminalCoordinator()!.forwardExecuteTool(name, args);
    }
    await deps.waitUntilReady();

    switch (name) {
        case 'get_setup_context': {
            const registry = readRegistry();
            const setupCtx = deps.getContext();
            return { content: [{ type: "text", text: JSON.stringify({ status: deps.getIsInitialized() ? "ALREADY_INITIALIZED" : "INITIALIZATION_REQUIRED", current_path: process.cwd(), registered_projects: registry, embeddings: setupCtx?.updatePipeline?.embeddingsAvailable ? 'enabled' : 'disabled' }, null, 2) }] };
        }
        case 'initialize_project': {
            // H-6: Prevent concurrent initialization across multiple MCP sessions
            if (initializationInProgress) {
                return { content: [{ type: 'text', text: 'Initialization already in progress. Please wait and retry.' }], isError: true };
            }
            initializationInProgress = true;
            try {

            const mode = args.mode ?? 'current';

            if (mode !== 'current' && mode !== 'existing' && mode !== 'custom') {
                return { content: [{ type: 'text', text: `Unknown mode: ${mode}. Valid values: current, existing, custom` }], isError: true };
            }

            // Determine raw path
            const rawPath: string = args.path ? args.path : process.cwd();

            // H-5: Resolve symlinks before boundary check
            let resolvedPath: string;
            try {
                resolvedPath = fs.realpathSync(rawPath);
            } catch {
                // Path doesn't exist yet — realpathSync fails on non-existent paths.
                // Fall back to path.resolve() for new project paths.
                resolvedPath = path.resolve(rawPath);
            }

            if (mode === 'current') {
                // Existing behavior: use args.path resolved or fall back to cwd.
                // Apply boundary check when an explicit path was provided.
                if (args.path) {
                    const homeDir = os.homedir();
                    const allowed = [homeDir, process.cwd()];
                    if (!allowed.some(base => resolvedPath === base || resolvedPath.startsWith(base + path.sep))) {
                        return { isError: true, content: [{ type: 'text', text: `Path '${resolvedPath}' is outside allowed boundaries (home dir or cwd).` }] };
                    }
                }
                const target = resolvedPath;
                if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
                if (!args.zero_pollution) fs.writeFileSync(path.join(target, ANCHOR_FILE), JSON.stringify({ created_at: new Date().toISOString() }));
                addToRegistry(target);
                if (deps.onInitialize) await deps.onInitialize(target);
                deps.markReady(true);
                return { content: [{ type: "text", text: `Successfully initialized project at ${target}. Analysis engine is now active.` }] };

            } else if (mode === 'existing') {
                // Re-use existing indexed DB without re-scanning the filesystem.
                // Apply boundary check when an explicit path was provided.
                if (args.path) {
                    const homeDir = os.homedir();
                    const allowed = [homeDir, process.cwd()];
                    if (!allowed.some(base => resolvedPath === base || resolvedPath.startsWith(base + path.sep))) {
                        return { isError: true, content: [{ type: 'text', text: `Path '${resolvedPath}' is outside allowed boundaries (home dir or cwd).` }] };
                    }
                }
                const target = resolvedPath;
                // Mount the project but skip full init if DB already has data.
                await deps.workspaceManager.mountProject(target);
                const hash = getProjectHash(target);
                const existingCtx = deps.workspaceManager.getContextByHash(hash);
                if (existingCtx && existingCtx.dbManager) {
                    // Already initialized — skip re-indexing
                    deps.markReady(true);
                    return { content: [{ type: 'text', text: `Project already indexed. Use mode 'current' to re-index.` }] };
                }
                // Not yet initialized — fall through to normal initialization
                if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
                if (!args.zero_pollution) fs.writeFileSync(path.join(target, ANCHOR_FILE), JSON.stringify({ created_at: new Date().toISOString() }));
                addToRegistry(target);
                if (deps.onInitialize) await deps.onInitialize(target);
                deps.markReady(true);
                return { content: [{ type: "text", text: `Successfully initialized project at ${target}. Analysis engine is now active.` }] };

            } else {
                // mode === 'custom'
                // Use args.projectPath / args.path as-is. Skip home/cwd boundary check.
                // Still apply the symlink fix (realpathSync already applied above).
                const target = resolvedPath;
                if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
                if (!args.zero_pollution) fs.writeFileSync(path.join(target, ANCHOR_FILE), JSON.stringify({ created_at: new Date().toISOString() }));
                addToRegistry(target);
                if (deps.onInitialize) await deps.onInitialize(target);
                deps.markReady(true);
                return { content: [{ type: "text", text: `Successfully initialized project at ${target}. Analysis engine is now active.` }] };
            }

            } finally {
                initializationInProgress = false;
            }
        }
        case 'search_symbols': {
            const limit = args.limit || 10;
            const settled = await Promise.allSettled(deps.workspaceManager.getAllContexts().map(async (ctx) => {
                const keywordNodes = ctx.graphEngine!.nodeRepo.searchSymbols(args.query, limit, { symbol_type: args.symbol_type });
                if (!args.semantic) return keywordNodes;
                try {
                    const queryVector = await deps.embeddingProvider.generate(args.query);
                    const vectorResults = ctx.vectorRepo!.search(queryVector, limit);
                    const vectorNodes = vectorResults.map(r => ctx.graphEngine!.getNodeById(r.id)).filter(n => n !== null);
                    return mergeResultsRRF(keywordNodes, vectorNodes, limit);
                } catch { return keywordNodes; }
            }));
            const results = settled
                .filter((r): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
                .map(r => r.value);
            const flat = results.flat().slice(0, limit);
            return { content: [{ type: "text", text: JSON.stringify(flat.map(n => ({ qname: n.qualified_name, type: n.symbol_type, file: n.file_path, tags: n.tags })), null, 2) }] };
        }
        case 'get_symbol_details': {
            // M-4: validate args.qualified_name is a string
            if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
                return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
            }
            // C-1: null guard for context
            const ctx = deps.getContext();
            if (!ctx || !ctx.graphEngine) {
                return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
            }
            const node = ctx.graphEngine.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };

            if (args.summary_only) return { content: [{ type: "text", text: JSON.stringify({ qname: node.qualified_name, type: node.symbol_type, metrics: { loc: node.loc, cyclomatic: node.cyclomatic, fan_in: node.fan_in, fan_out: node.fan_out } }, null, 2) }] };

            let text = `### Symbol: ${node.qualified_name}\n`;
            text += `- **Type**: ${node.symbol_type}\n`;
            if (node.signature) text += `- **Signature**: ${node.signature}\n`;
            text += `- **File**: ${node.file_path} (line ${node.start_line}-${node.end_line})\n`;

            // L-2: tags is always string[] | undefined per type definition — Array.isArray branch removed
            if (node.tags && node.tags.length > 0) {
                text += `- **Structural Tags**: ${node.tags.join(', ')}\n`;
            }

            if (node.history && node.history.length > 0) {
                text += `\n#### Historical Evidence:\n`;
                node.history.slice(0, 3).forEach(commit => {
                    text += `- **[${commit.hash.substring(0, 7)}]** ${commit.message} (by ${commit.author})\n`;
                });
            }

            text += `\n#### Metrics:\n- LOC: ${node.loc}, CC: ${node.cyclomatic}\n- Static Coupling: Fan-in: ${node.fan_in || 0}, Fan-out: ${node.fan_out || 0}\n`;

            if (args.include_source !== false) {
                if (!ctx.securityProvider) {
                    text += '\n\n> [!WARNING] Source code unavailable: security provider not initialized.';
                } else {
                    try {
                        ctx.securityProvider.validatePath(node.file_path);
                        const content = fs.readFileSync(node.file_path, 'utf8').split('\n');
                        // M-6: validate start_line/end_line before slicing
                        if (node.start_line < 1 || node.end_line < node.start_line) {
                            text += '\n> [!WARNING] Invalid line range in database record.';
                        } else {
                            const snippet = content.slice(node.start_line - 1, node.end_line);
                            const display = snippet.length > 100 ?
                                snippet.slice(0, 50).join('\n') + "\n\n// ... [Truncated for Token Optimization: Use read_file for full content] ..." :
                                snippet.join('\n');
                            text += '\n#### Source Code Snippet:\n```\n' + display + '\n```\n';
                        }
                    } catch (e: any) {
                        // L-1: distinguish ENOENT vs EACCES
                        const reason = e.code === 'ENOENT' ? 'File not found'
                            : e.code === 'EACCES' ? 'Permission denied'
                            : String(e);
                        text += `\n> [!WARNING] Source unavailable: ${reason}`;
                    }
                }
            }
            return { content: [{ type: "text", text }] };
        }
        case 'analyze_impact': {
            // M-4: validate args.qualified_name is a string
            if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
                return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
            }
            // C-1: null guard for context
            const ctx = deps.getContext();
            if (!ctx || !ctx.graphEngine) {
                return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
            }
            const node = ctx.graphEngine.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
            const depth = Math.min(typeof args.max_depth === 'number' && !Number.isNaN(args.max_depth) ? args.max_depth : 5, 20);
            const results = ctx.graphEngine.traverse(node.id!, 'BFS', { direction: 'incoming', maxDepth: depth, useCache: args.use_cache });
            const formatted = results.map(r => ({
                node: r.node.qualified_name,
                distance: r.distance,
                impact_path: r.path.map(step => ctx.graphEngine!.getNodeById(step.nodeId)?.qualified_name).reverse().join(' -> ')
            }));
            return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
        }
        case 'get_callers': {
            // M-4: validate args.qualified_name is a string
            if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
                return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
            }
            // C-1: null guard for context
            const ctx = deps.getContext();
            if (!ctx || !ctx.graphEngine) {
                return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
            }
            const node = ctx.graphEngine.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
            // M-3: use JOIN query to avoid N+1 getNodeById calls
            const callers = ctx.graphEngine.getIncomingEdgesWithCallerNames(node.id!);
            return { content: [{ type: "text", text: JSON.stringify(callers.map(r => ({ qname: r.qualified_name, line: r.call_site_line })), null, 2) }] };
        }
        case 'get_callees': {
            // M-4: validate args.qualified_name is a string
            if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
                return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
            }
            // C-1: null guard for context
            const ctx = deps.getContext();
            if (!ctx || !ctx.graphEngine) {
                return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
            }
            const node = ctx.graphEngine.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };
            // M-3: use JOIN query to avoid N+1 getNodeById calls
            const callees = ctx.graphEngine.getOutgoingEdgesWithCalleeNames(node.id!);
            return { content: [{ type: "text", text: JSON.stringify(callees.map(r => ({ qname: r.qualified_name, line: r.call_site_line })), null, 2) }] };
        }
        case 'get_related_tests': {
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            if (!args.qualified_name) {
                return { content: [{ type: 'text', text: 'Error: qualified_name is required.' }], isError: true };
            }
            const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
            if (!node) return { isError: true, content: [{ type: "text", text: "Symbol not found" }] };

            // 1. Direct tests edges pointing to this node
            const directTests = ctx.graphEngine!.getIncomingEdges(node.id!)
                .filter(e => e.edge_type === 'tests')
                .map(e => ctx.graphEngine!.getNodeById(e.from_id)?.qualified_name)
                .filter((q): q is string => q != null);

            // 2. File-level tests edges (test file → production file that contains this symbol)
            let fileTests: string[] = [];
            if (node.symbol_type !== 'file') {
                const fileQname = toCanonical(node.file_path);
                const fileNode = ctx.graphEngine!.getNodeByQualifiedName(fileQname);
                if (fileNode) {
                    fileTests = ctx.graphEngine!.getIncomingEdges(fileNode.id!)
                        .filter(e => e.edge_type === 'tests')
                        .map(e => ctx.graphEngine!.getNodeById(e.from_id)?.qualified_name)
                        .filter((q): q is string => q != null);
                }
            }

            const allTests = [...new Set([...directTests, ...fileTests])];
            return { content: [{ type: "text", text: JSON.stringify(allTests, null, 2) }] };
        }
        case 'check_architecture_violations': {
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            const violations = await ctx.archEngine!.checkViolations();
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
            if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
                return { content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }], isError: true };
            }
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            const proposal = await ctx.refactorEngine!.proposeRefactor(args.qualified_name);
            return { content: [{ type: "text", text: JSON.stringify(proposal, null, 2) }] };
        }
        case 'get_risk_profile': {
            if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
                return { content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }], isError: true };
            }
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            const profile = await ctx.refactorEngine!.getRiskProfile(args.qualified_name);
            return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
        }
        case 'get_hotspots': {
            const ALLOWED_METRICS = ['cyclomatic', 'fan_in', 'fan_out', 'loc'] as const;
            type AllowedMetric = typeof ALLOWED_METRICS[number];
            // M-4: validate metric type and threshold type
            if (typeof args.metric !== 'string') {
                return { isError: true, content: [{ type: 'text', text: 'Invalid argument: metric must be a string.' }] };
            }
            if (!ALLOWED_METRICS.includes(args.metric as AllowedMetric)) {
                return { isError: true, content: [{ type: 'text', text: `Invalid metric '${args.metric}'. Allowed values: ${ALLOWED_METRICS.join(', ')}` }] };
            }
            if (args.threshold !== undefined && (typeof args.threshold !== 'number' || Number.isNaN(args.threshold))) {
                return { isError: true, content: [{ type: 'text', text: 'Invalid argument: threshold must be a number.' }] };
            }
            // C-1: null guard for context
            const ctx = deps.getContext();
            if (!ctx || !ctx.dbManager) {
                return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
            }
            const db = ctx.dbManager.getDb();
            const hotspots = db.prepare(`SELECT qualified_name, symbol_type, ${args.metric} FROM nodes WHERE ${args.metric} >= ? ORDER BY ${args.metric} DESC LIMIT 20`).all(args.threshold || 0);
            return { content: [{ type: "text", text: JSON.stringify(hotspots, null, 2) }] };
        }
        case 'find_dead_code': {
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            const report = await ctx.optEngine!.findDeadCode();
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
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            const format = args.format ?? 'json';
            const graphOptions = { rootQName: args.root_qname, maxDepth: args.max_depth || 2 };

            if (format === 'json') {
                const mermaid = await ctx.graphEngine!.exportToMermaid(graphOptions);
                const data = await ctx.graphEngine!.getGraphData(graphOptions);
                const summary = `### Graph Export: ${args.root_qname || 'Root'}\n- Nodes: ${data.nodes.length}\n- Edges: ${data.edges.length}\n\n${mermaid}\n`;
                return { content: [{ type: "text", text: summary }] };
            } else if (format === 'graphml') {
                const data = await ctx.graphEngine!.getGraphData(graphOptions);
                const nodeMap = new Map<number, string>(
                    data.nodes.map(n => [n.id!, n.qualified_name ?? String(n.id!)])
                );
                let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
                xml += '<graphml xmlns="http://graphml.graphdrawing.org/graphml">\n';
                xml += '  <graph id="G" edgedefault="directed">\n';
                for (const n of data.nodes) {
                    xml += `    <node id="${escapeXml(n.qualified_name ?? String(n.id!))}"/>\n`;
                }
                for (const e of data.edges) {
                    const src = nodeMap.get(e.from_id) ?? String(e.from_id);
                    const tgt = nodeMap.get(e.to_id) ?? String(e.to_id);
                    xml += `    <edge source="${escapeXml(src)}" target="${escapeXml(tgt)}"/>\n`;
                }
                xml += '  </graph>\n</graphml>';
                return { content: [{ type: 'text', text: xml }] };
            } else if (format === 'dot') {
                const data = await ctx.graphEngine!.getGraphData(graphOptions);
                const nodeMap = new Map<number, string>(
                    data.nodes.map(n => [n.id!, n.qualified_name ?? String(n.id!)])
                );
                let dot = 'digraph G {\n';
                for (const n of data.nodes) {
                    dot += `  "${escapeDot(n.qualified_name ?? String(n.id!))}";\n`;
                }
                for (const e of data.edges) {
                    const src = nodeMap.get(e.from_id) ?? String(e.from_id);
                    const tgt = nodeMap.get(e.to_id) ?? String(e.to_id);
                    dot += `  "${escapeDot(src)}" -> "${escapeDot(tgt)}";\n`;
                }
                dot += '}';
                return { content: [{ type: 'text', text: dot }] };
            } else {
                return { content: [{ type: 'text', text: `Unknown format: ${format}. Supported: json, graphml, dot` }], isError: true };
            }
        }
        case 'check_consistency': {
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            const checker = new ConsistencyChecker(ctx.graphEngine!.nodeRepo, ctx.gitService!, ctx.updatePipeline!, ctx.projectPath);
            const results = await checker.validate(args.repair, args.force);
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }
        case 'purge_index': {
            if (!args.confirm) return { content: [{ type: "text", text: "WARNING: This deletes all index data. Confirm with 'confirm: true'" }] };
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            const dbPath = getDatabasePath(ctx.projectPath);
            if (deps.onPurge) await deps.onPurge();
            ctx.dbManager?.dispose();
            deps.setIsInitialized(false);
            [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
            if (args.unregister) removeFromRegistry(ctx.projectPath);
            return { content: [{ type: "text", text: "Project index purged successfully. Server in PENDING mode." }] };
        }
        case 're_tag_project': {
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            // H-6: Terminal mode guard — long-running operations unavailable in Terminal mode
            if (deps.isTerminal()) {
                return { content: [{ type: 'text', text: 'This operation is not available in Terminal mode.' }], isError: true };
            }
            const pipeline = ctx.updatePipeline!;
            await pipeline.reTagAllNodes();
            return { content: [{ type: "text", text: "Successfully re-tagged all nodes." }] };
        }
        case 'backfill_history': {
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            // H-6: Terminal mode guard — long-running operations unavailable in Terminal mode
            if (deps.isTerminal()) {
                return { content: [{ type: 'text', text: 'This operation is not available in Terminal mode.' }], isError: true };
            }
            const pipeline = ctx.updatePipeline!;
            await pipeline.mapHistoryToProject();
            return { content: [{ type: "text", text: "Successfully backfilled Git history." }] };
        }
        case 'discover_latent_policies': {
            const ctx = deps.getContext();
            if (!ctx) {
                return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
            }
            if (args.min_confidence !== undefined && (typeof args.min_confidence !== 'number' || Number.isNaN(args.min_confidence) || args.min_confidence < 0 || args.min_confidence > 1)) {
                return { content: [{ type: 'text', text: 'Invalid argument: min_confidence must be a number between 0 and 1.' }], isError: true };
            }
            if (args.max_policies !== undefined && (typeof args.max_policies !== 'number' || Number.isNaN(args.max_policies) || args.max_policies < 1 || !Number.isInteger(args.max_policies))) {
                return { content: [{ type: 'text', text: 'Invalid argument: max_policies must be a positive integer.' }], isError: true };
            }
            const policies = await ctx.policyDiscoverer!.discoverPolicies(args.threshold, args.min_count);
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

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeDot(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

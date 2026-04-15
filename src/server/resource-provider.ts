/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Server as SdkMcpServer } from "@modelcontextprotocol/sdk/server/index.js";
import {
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    McpError,
    ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { EngineContext } from './workspace-manager';

/** SQLite COUNT(*) row shape */
interface CountRow { count: number; }
/** Cluster row shape from logical_clusters table */
interface ClusterRow { id: number; [key: string]: unknown; }

export function registerResourceHandlers(
    sdkServer: SdkMcpServer,
    waitUntilReady: () => Promise<void>,
    getContext: () => EngineContext
): void {
    sdkServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [
            { uri: "graph://ledger", name: "Knowledge Graph Ledger", mimeType: "application/json", description: "Global call ledger and consistency metrics" },
            { uri: "graph://summary", name: "Graph Summary", mimeType: "application/json", description: "Summary of nodes, edges and files" },
            { uri: "graph://hotspots", name: "Graph Hotspots", mimeType: "application/json", description: "Technical debt hotspots (Complexity & Coupling)" },
            { uri: "graph://clusters", name: "Logical Clusters", mimeType: "application/json", description: "Semantic groupings into logical modules" }
        ]
    }));

    sdkServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        await waitUntilReady();
        const ctx = getContext();
        const db = ctx.dbManager!.getDb();
        const uri = request.params.uri;

        if (uri === "graph://ledger") {
            return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(ctx.metadataRepo!.getLedgerStats(), null, 2) }] };
        }
        if (uri === "graph://summary") {
            const nodeCount = (db.prepare("SELECT COUNT(*) as count FROM nodes").get() as CountRow).count;
            const edgeCount = (db.prepare("SELECT COUNT(*) as count FROM edges").get() as CountRow).count;
            const fileCount = (db.prepare("SELECT COUNT(DISTINCT file_path) as count FROM nodes").get() as CountRow).count;
            return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ nodes: nodeCount, edges: edgeCount, files: fileCount, project: ctx.projectPath, last_updated: new Date().toISOString() }, null, 2) }] };
        }
        if (uri === "graph://hotspots") {
            const topComplexity = db.prepare("SELECT qualified_name, symbol_type, cyclomatic FROM nodes ORDER BY cyclomatic DESC LIMIT 10").all();
            const topFanIn = db.prepare("SELECT qualified_name, symbol_type, fan_in FROM nodes ORDER BY fan_in DESC LIMIT 10").all();
            return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ by_complexity: topComplexity, by_fan_in: topFanIn, last_updated: new Date().toISOString() }, null, 2) }] };
        }
        if (uri === "graph://clusters") {
            const clusters = db.prepare("SELECT * FROM logical_clusters").all();
            const result = (clusters as ClusterRow[]).map((c) => {
                const count = (db.prepare("SELECT COUNT(*) as count FROM nodes WHERE cluster_id = ?").get(c.id) as CountRow).count;
                return { ...c, node_count: count };
            });
            return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result, null, 2) }] };
        }
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    });
}

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';
import { escapeXml, escapeDot } from './_utils.js';

export const exportGraphHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
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
};

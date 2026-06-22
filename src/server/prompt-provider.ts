/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Server as SdkMcpServer } from "@modelcontextprotocol/sdk/server/index.js";
import {
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
    McpError,
    ErrorCode
} from "@modelcontextprotocol/sdk/types.js";

export function registerPromptHandlers(
    sdkServer: SdkMcpServer,
    waitUntilReady: () => Promise<void>
): void {
    sdkServer.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: [
            {
                name: "onboard-codebase",
                description: "Bootstrap context on an unfamiliar codebase using the project overview"
            },
            {
                name: "explain-impact",
                description: "Explain ripple effect of changing a symbol",
                arguments: [{ name: "qualified_name", description: "The qualified name of the symbol", required: true }]
            },
            {
                name: "find-similar",
                description: "Find semantically similar symbols (duplicates, patterns, refactor candidates)",
                arguments: [{ name: "qualified_name", description: "The qualified name of the symbol", required: true }]
            },
            {
                name: "trace-history",
                description: "Explain why a symbol exists from its commit history (requires backfill_history)",
                arguments: [{ name: "qualified_name", description: "The qualified name of the symbol", required: true }]
            },
            {
                name: "check-health",
                description: "Check graph health and consistency"
            },
            {
                name: "refactor-safety",
                description: "Perform a comprehensive safety check before refactoring a symbol",
                arguments: [{ name: "qualified_name", description: "The qualified name of the symbol", required: true }]
            }
        ]
    }));

    sdkServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
        await waitUntilReady();
        const name = request.params.name;
        const args = request.params.arguments || {};

        if (name === "onboard-codebase") {
            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Help me get oriented in this codebase. Start by calling 'get_project_overview' to learn its purpose, tech stack, architecture shape, entry points, and hotspots. Then read the 'graph://summary' and 'graph://hotspots' resources, and summarize what this project does and where the important code lives.`
                    }
                }]
            };
        }
        if (name === "explain-impact") {
            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Please analyze the impact of changing the symbol '${args.qualified_name}'. Use the 'analyze_impact' tool to find incoming dependencies and explain what might break.`
                    }
                }]
            };
        }
        if (name === "find-similar") {
            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Use the 'find_similar_symbols' tool on '${args.qualified_name}' to find semantically similar code. Report likely duplicates or shared patterns, and note any refactoring opportunities (e.g. extracting a common helper).`
                    }
                }]
            };
        }
        if (name === "trace-history") {
            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `Explain why the symbol '${args.qualified_name}' exists and how it evolved. Use 'get_symbol_history' to read its commit history with an intent summary (this requires 'backfill_history' to have been run). Also check 'get_annotations' for any decisions or gotchas recorded against it, then summarize the rationale.`
                    }
                }]
            };
        }
        if (name === "check-health") {
            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: "Please run a consistency check on the knowledge graph using the 'check_consistency' tool and report any issues found."
                    }
                }]
            };
        }
        if (name === "refactor-safety") {
            return {
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: `I am planning to refactor the symbol '${args.qualified_name}'.
Please follow this safety protocol:\n1. Read 'graph://ledger' to verify the current index integrity.\n2. Use 'analyze_impact' with 'qualified_name: ${args.qualified_name}' to identify all incoming dependencies.\n3. Use 'get_symbol_details' to check the complexity and metrics of '${args.qualified_name}'.\n4. Use 'get_related_tests' to find the tests that cover it.\n5. Provide a risk assessment summary: (Low/Medium/High risk) based on the number of dependencies, complexity, and test coverage.\n6. If you proceed, record the decision with 'add_annotation' (kind: "decision") so future sessions understand the change.`
                    }
                }]
            };
        }
        throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
    });
}

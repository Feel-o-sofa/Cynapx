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
                name: "explain-impact",
                description: "Explain ripple effect of changing a symbol",
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
Please follow this safety protocol:\n1. Read 'graph://ledger' to verify the current index integrity.\n2. Use 'analyze_impact' with 'qualified_name: ${args.qualified_name}' to identify all incoming dependencies.\n3. Use 'get_symbol_details' to check the complexity and metrics of '${args.qualified_name}'.\n4. Provide a risk assessment summary: (Low/Medium/High risk) based on the number of dependencies and complexity.`
                    }
                }]
            };
        }
        throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
    });
}

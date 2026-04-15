/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as readline from 'readline';
import { McpServer } from './mcp-server';

/**
 * Provides an interactive REPL for executing MCP tools directly from the terminal.
 */
export class InteractiveShell {
    private rl: readline.Interface | null = null;
    private isRunning: boolean = false;
    private tools = [
        'search_symbols', 'get_symbol_details', 'analyze_impact',
        'check_architecture_violations', 'propose_refactor', 'find_dead_code',
        'get_remediation_strategy', 'export_graph', 're_tag_project',
        'discover_latent_policies', 'check_consistency', 'backfill_history',
        'purge_index', 'initialize_project', 'get_setup_context',
        'get_callers', 'get_callees', 'get_related_tests', 'perform_clustering',
        'get_risk_profile', 'get_hotspots'
    ];

    constructor(private mcpServer: McpServer) {}

    /**
     * Starts the interactive shell loop.
     */
    public start() {
        if (this.isRunning) return;
        this.isRunning = true;

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: this.getPrompt(),
            completer: (line: string) => {
                const hits = this.tools.filter((t) => t.startsWith(line));
                return [hits.length ? hits : this.tools, line];
            }
        });

        console.error(`\n\x1b[36m--- Cynapx Interactive Shell ---\x1b[0m`);
        console.error(`Type \x1b[33m.tools\x1b[0m to list available tools, or \x1b[33m.exit\x1b[0m to quit.`);
        console.error(`Usage: \x1b[32mtool_name {"arg": "value"}\x1b[0m\n`);

        this.rl.prompt();

        this.rl.on('line', async (line) => {
            const trimmed = line.trim();
            if (!trimmed) {
                this.rl?.prompt();
                return;
            }

            if (trimmed === '.exit' || trimmed === 'exit' || trimmed === 'quit') {
                this.stop();
                process.emit('SIGINT');
                return;
            }

            if (trimmed === '.tools' || trimmed === 'help') {
                this.listTools();
                this.rl?.prompt();
                return;
            }

            if (trimmed === '.status') {
                this.showStatus();
                this.rl?.prompt();
                return;
            }

            if (trimmed.startsWith('.semantic ')) {
                const query = trimmed.substring(10).trim();
                await this.handleCommand(`search_symbols {"query": "${query}", "semantic": true}`);
                this.rl?.prompt();
                return;
            }

            // Execute command
            await this.handleCommand(trimmed);
            
            // Refresh prompt in case role changed (promotion)
            this.rl?.setPrompt(this.getPrompt());
            this.rl?.prompt();
        });

        this.rl.on('close', () => {
            this.isRunning = false;
        });
    }

    private getPrompt(): string {
        const role = this.mcpServer.isInTerminalMode ? 'term' : 'host';
        const color = role === 'host' ? '\x1b[35m' : '\x1b[34m';
        return `${color}cynapx(${role})>\x1b[0m `;
    }

    private async handleCommand(line: string) {
        const spaceIndex = line.indexOf(' ');
        const name = spaceIndex === -1 ? line : line.substring(0, spaceIndex);
        const argsStr = spaceIndex === -1 ? '{}' : line.substring(spaceIndex + 1);

        try {
            // Attempt to parse args as JSON
            let args: any;
            try {
                args = JSON.parse(argsStr);
            } catch (parseErr) {
                console.error(`\x1b[31mInvalid JSON arguments:\x1b[0m ${argsStr}`);
                console.error(`Example: search_symbols {"query": "Main"}`);
                return;
            }

            console.error(`\x1b[90m[*] Executing ${name}...\x1b[0m`);
            const result = await this.mcpServer.executeTool(name, args);
            
            if (result.isError) {
                console.error('\x1b[31m[Error]\x1b[0m');
                console.log(JSON.stringify(result.content, null, 2));
            } else {
                console.error('\x1b[32m[Result]\x1b[0m');
                result.content.forEach((c: any) => {
                    if (c.type === 'text') {
                        console.log(c.text);
                    } else {
                        console.log(JSON.stringify(c, null, 2));
                    }
                });
            }
        } catch (err: any) {
            console.error(`\x1b[31m[Execution Failed]\x1b[0m ${err.message || err}`);
        }
    }

    private listTools() {
        console.error('\nAvailable Tools:');
        const sorted = [...this.tools].sort();
        // Print in 2 columns
        for (let i = 0; i < sorted.length; i += 2) {
            const t1 = sorted[i].padEnd(30);
            const t2 = sorted[i + 1] || '';
            console.error(`  - ${t1} - ${t2}`);
        }
        console.error('\nSpecial Commands:');
        console.error('  - .tools  : Show this list');
        console.error('  - .status : Show session role and connection status');
        console.error('  - .exit   : Exit Cynapx\n');
    }

    private showStatus() {
        const isTerminal = this.mcpServer.isInTerminalMode;
        const isInitialized = this.mcpServer.isReady;
        console.error(`\nSession Status:`);
        console.error(`  Role        : ${isTerminal ? 'Terminal (Proxy)' : 'Host (Direct DB)'}`);
        console.error(`  Initialized : ${isInitialized ? 'Yes' : 'No'}`);
        console.error(`  PID         : ${process.pid}\n`);
    }

    public stop() {
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        this.isRunning = false;
    }
}

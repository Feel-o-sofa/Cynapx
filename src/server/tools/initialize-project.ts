/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { addToRegistry, ANCHOR_FILE, getProjectHash } from '../../utils/paths.js';
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

// H-6: Module-level mutex flag to prevent concurrent initialization across sessions
let initializationInProgress = false;

export const initializeProjectHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
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
};

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageProvider } from './types';
import * as path from 'path';
import * as fs from 'fs';

export class LanguageRegistry {
    private static instance: LanguageRegistry;
    private providers: Map<string, LanguageProvider> = new Map();
    private pluginDirs: string[] = [path.resolve(__dirname, 'languages')];
    
    // Map extensions to provider module names for lazy loading
    private extensionMap: Map<string, string> = new Map([
        ['py', './languages/python'],
        ['ts', './languages/typescript'],
        ['js', './languages/javascript'],
        ['c', './languages/c'],
        ['h', './languages/c'],
        ['cpp', './languages/cpp'],
        ['cc', './languages/cpp'],
        ['hpp', './languages/cpp'],
        ['rs', './languages/rust'],
        ['go', './languages/go'],
        ['gd', './languages/gdscript'],
        ['java', './languages/java'],
        ['kt', './languages/kotlin'],
        ['kts', './languages/kotlin'],
        ['cs', './languages/csharp'],
        ['php', './languages/php']
    ]);

    private constructor() {
        // Automatically scan ~/.cynapx/plugins if it exists
        const userPluginDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.cynapx', 'plugins');
        if (fs.existsSync(userPluginDir)) {
            this.pluginDirs.push(userPluginDir);
        }
    }

    public static getInstance(): LanguageRegistry {
        if (!this.instance) {
            this.instance = new LanguageRegistry();
        }
        return this.instance;
    }

    public register(provider: LanguageProvider): void {
        provider.extensions.forEach(ext => {
            this.providers.set(ext.toLowerCase(), provider);
        });
    }

    public getProvider(filePath: string): LanguageProvider | undefined {
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (!ext) return undefined;

        if (this.providers.has(ext)) {
            return this.providers.get(ext);
        }

        // Try to load from internal extension map
        const modulePath = this.extensionMap.get(ext);
        if (modulePath) {
            try {
                const fullPath = path.resolve(__dirname, modulePath);
                const module = require(fullPath);
                const className = modulePath.split('/').pop()!.charAt(0).toUpperCase() + modulePath.split('/').pop()!.slice(1) + 'Provider';
                const provider = new module[className]();
                this.register(provider);
                return provider;
            } catch (err) {
                console.error(`LanguageRegistry: Failed to lazy load provider for .${ext}: ${err}`);
            }
        }

        return undefined;
    }

    public getAllExtensions(): string[] {
        const extensions = Array.from(this.extensionMap.keys());
        // Also add extensions from dynamically loaded providers
        this.providers.forEach(p => {
            p.extensions.forEach(ext => {
                if (!extensions.includes(ext)) extensions.push(ext);
            });
        });
        return extensions;
    }
}

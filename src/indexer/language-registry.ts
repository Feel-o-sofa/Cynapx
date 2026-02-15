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
        this.scanPlugins();
    }

    public static getInstance(): LanguageRegistry {
        if (!this.instance) {
            this.instance = new LanguageRegistry();
        }
        return this.instance;
    }

    private scanPlugins(): void {
        for (const dir of this.pluginDirs) {
            if (!fs.existsSync(dir)) continue;
            
            // Skip the internal 'languages' dir for dynamic scanning as it's handled by extensionMap lazy loading
            if (dir === path.resolve(__dirname, 'languages')) continue;

            try {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    if (file.endsWith('.js') || file.endsWith('.ts')) {
                        const fullPath = path.join(dir, file);
                        this.tryRegisterPlugin(fullPath);
                    }
                }
            } catch (err) {
                console.error(`LanguageRegistry: Error scanning directory ${dir}: ${err}`);
            }
        }
    }

    private tryRegisterPlugin(fullPath: string): void {
        try {
            // Using require for plugin loading
            const plugin = require(fullPath);
            let registeredCount = 0;

            for (const key in plugin) {
                const Exported = plugin[key];
                if (typeof Exported === 'function') {
                    try {
                        const instance = new Exported();
                        if (this.isLanguageProvider(instance)) {
                            this.register(instance);
                            registeredCount++;
                        }
                    } catch {
                        // Not a constructible provider class, skip
                    }
                }
            }
            if (registeredCount > 0) {
                console.error(`LanguageRegistry: Registered ${registeredCount} provider(s) from ${fullPath}`);
            }
        } catch (err) {
            console.error(`LanguageRegistry: Failed to load plugin ${fullPath}: ${err}`);
        }
    }

    private isLanguageProvider(obj: any): obj is LanguageProvider {
        return obj && 
               Array.isArray(obj.extensions) && 
               typeof obj.languageName === 'string' &&
               typeof obj.getLanguage === 'function' &&
               typeof obj.getQuery === 'function';
    }

    public register(provider: LanguageProvider): void {
        provider.extensions.forEach(ext => {
            const normalizedExt = ext.toLowerCase();
            // External plugins or explicit registration takes precedence over lazy internal map
            this.providers.set(normalizedExt, provider);
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

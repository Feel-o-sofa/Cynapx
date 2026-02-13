import { LanguageProvider } from './types';
import * as path from 'path';

export class LanguageRegistry {
    private static instance: LanguageRegistry;
    private providers: Map<string, LanguageProvider> = new Map();
    
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
        ['cs', './languages/csharp']
    ]);

    private constructor() { }

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

        // 1. Check already loaded providers
        if (this.providers.has(ext)) {
            return this.providers.get(ext);
        }

        // 2. Try Lazy Loading
        const modulePath = this.extensionMap.get(ext);
        if (modulePath) {
            try {
                // Using require for synchronous loading in indexer context
                const fullPath = path.resolve(__dirname, modulePath);
                const module = require(fullPath);
                
                // Expecting provider class to be exported as LanguageNameProvider (e.g. PythonProvider)
                const className = modulePath.split('/').pop()!.charAt(0).toUpperCase() + modulePath.split('/').pop()!.slice(1) + 'Provider';
                const provider = new module[className]();
                
                this.register(provider);
                console.error(`LanguageRegistry: Lazily loaded ${className} for .${ext}`);
                return provider;
            } catch (err) {
                console.error(`LanguageRegistry: Failed to lazy load provider for .${ext}: ${err}`);
            }
        }

        return undefined;
    }

    public getAllExtensions(): string[] {
        return Array.from(this.extensionMap.keys());
    }
}

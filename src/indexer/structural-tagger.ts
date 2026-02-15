/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { CodeNode } from '../types';
import * as path from 'path';

/**
 * StructuralTagger extracts physical and structural characteristics of symbols.
 */
export class StructuralTagger {
    // Priority for consolidation (lower number = more primitive/fundamental)
    private static ROLE_PRIORITY: Record<string, number> = {
        'role:repository': 1,
        'role:parser': 2,
        'role:server': 3,
        'role:controller': 4,
        'role:service': 5,
        'role:utility': 10
    };

    /**
     * Merges roles from parents into the current node's tags.
     * Consolidates primitive roles and lists distinct roles in parallel.
     */
    public static mergeRoles(currentTags: string[], parentTags: string[]): string[] {
        // If the current node is marked as internal, do not inherit parent roles
        if (currentTags.includes('trait:internal')) {
            return currentTags;
        }

        const tagSet = new Set(currentTags);
        const parentRoles = parentTags.filter(t => t.startsWith('role:'));

        for (const pRole of parentRoles) {
            let shouldAdd = true;
            
            // Check for consolidation with existing roles
            for (const cTag of Array.from(tagSet)) {
                if (!cTag.startsWith('role:')) continue;

                const pPriority = this.ROLE_PRIORITY[pRole] || 99;
                const cPriority = this.ROLE_PRIORITY[cTag] || 99;

                if (pRole === cTag) {
                    shouldAdd = false;
                    break;
                }

                // If they are related (e.g., repository and utility), 
                // keep the more primitive one (lower priority number)
                if (this.isRelated(pRole, cTag)) {
                    if (pPriority < cPriority) {
                        tagSet.delete(cTag);
                        shouldAdd = true;
                    } else {
                        shouldAdd = false;
                    }
                    break;
                }
            }

            if (shouldAdd) tagSet.add(pRole);
        }

        return Array.from(tagSet);
    }

    /**
     * Determines if two roles are related enough to be consolidated.
     * For now, we consolidate 'utility' with anything else.
     */
    private static isRelated(roleA: string, roleB: string): boolean {
        if (roleA === 'role:utility' || roleB === 'role:utility') return true;
        // Add more specific relationship logic here as the role system grows
        return false;
    }

    /**
     * Extracts and assigns baseline tags to a node based on its properties.
     */
    public static tagNode(node: CodeNode): string[] {
        const tags: Set<string> = new Set(node.tags || []);

        // 1. Layer Detection (based on directory structure)
        const parts = node.file_path.toLowerCase().split(/[\\/]/);
        if (parts.includes('db') || parts.includes('repository')) tags.add('layer:data');
        if (parts.includes('server') || parts.includes('api')) tags.add('layer:api');
        if (parts.includes('indexer') || parts.includes('engine')) tags.add('layer:core');
        if (parts.includes('utils') || parts.includes('shared')) tags.add('layer:utility');
        if (parts.includes('types') || parts.includes('domain')) tags.add('layer:domain');

        // 2. Role Detection (based on naming conventions)
        const fullName = node.qualified_name.toLowerCase();
        const symbolPart = fullName.split('#').pop() || '';

        if (symbolPart.includes('repository') || symbolPart.includes('repo')) tags.add('role:repository');
        if (symbolPart.includes('service')) tags.add('role:service');
        if (symbolPart.includes('controller')) tags.add('role:controller');
        if (symbolPart.includes('parser')) tags.add('role:parser');
        if (symbolPart.includes('server')) tags.add('role:server');
        if (symbolPart.includes('util')) tags.add('role:utility');

        // 3. Trait Detection
        if (node.symbol_type === 'interface') tags.add('trait:abstract');
        if (node.modifiers?.some(m => m.toLowerCase().includes('abstract'))) tags.add('trait:abstract');
        if (node.modifiers?.some(m => m.toLowerCase().includes('static'))) tags.add('trait:static');
        if (node.is_generated) tags.add('trait:generated');
        if (node.remote_project_path) tags.add('trait:external');

        // 4. Visibility & Access Detection
        const rawSymbolName = node.qualified_name.split('#').pop() || '';
        if (node.visibility === 'private' || node.visibility === 'protected' || rawSymbolName.startsWith('_')) {
            tags.add('trait:internal');
        } else if (node.visibility === 'public' || /^[A-Z]/.test(rawSymbolName)) {
            // Treat PascalCase symbols (Classes/Interfaces) or explicit public as public
            tags.add('trait:public');
        }

        // Entry point detection (basic)
        const fileName = node.file_path.toLowerCase();
        if (node.symbol_type === 'file' && (fileName.endsWith('main.ts') || fileName.endsWith('bootstrap.ts') || fileName.endsWith('index.ts'))) {
            tags.add('trait:entrypoint');
        }

        return Array.from(tags);
    }
}

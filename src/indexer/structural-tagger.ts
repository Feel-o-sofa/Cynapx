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
    /**
     * Extracts and assigns tags to a node based on its properties.
     */
    public static tagNode(node: CodeNode): string[] {
        const tags: Set<string> = new Set(node.tags || []);

        // 1. Layer Detection (based on directory structure)
        const parts = node.file_path.split(/[\\/]/);
        if (parts.includes('db') || parts.includes('repository')) tags.add('layer:data');
        if (parts.includes('server') || parts.includes('api')) tags.add('layer:api');
        if (parts.includes('indexer') || parts.includes('engine')) tags.add('layer:core');
        if (parts.includes('utils') || parts.includes('shared')) tags.add('layer:utility');
        if (parts.includes('types') || parts.includes('domain')) tags.add('layer:domain');

        // 2. Role Detection (based on naming conventions)
        const name = node.qualified_name.toLowerCase();
        if (name.endsWith('repository') || name.includes('repo')) tags.add('role:repository');
        if (name.endsWith('service')) tags.add('role:service');
        if (name.endsWith('controller')) tags.add('role:controller');
        if (name.endsWith('parser')) tags.add('role:parser');
        if (name.endsWith('server')) tags.add('role:server');
        if (name.endsWith('util') || name.endsWith('utils')) tags.add('role:utility');

        // 3. Trait Detection
        if (node.symbol_type === 'interface') tags.add('trait:abstract');
        if (node.modifiers?.includes('abstract')) tags.add('trait:abstract');
        if (node.modifiers?.includes('static')) tags.add('trait:static');
        if (node.is_generated) tags.add('trait:generated');
        if (node.remote_project_path) tags.add('trait:external');

        // Entry point detection (basic)
        if (node.symbol_type === 'file' && (node.file_path.endsWith('main.ts') || node.file_path.endsWith('bootstrap.ts') || node.file_path.endsWith('index.ts'))) {
            tags.add('trait:entrypoint');
        }

        return Array.from(tags);
    }
}

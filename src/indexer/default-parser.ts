/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { CompositeParser } from './composite-parser';
import { TypeScriptParser } from './typescript-parser';
import { TreeSitterParser } from './tree-sitter-parser';
import { DependencyParser } from './dependency-parser';
import { YamlParser } from './yaml-parser';
import { MarkdownParser } from './markdown-parser';
import { JsonConfigParser } from './json-config-parser';

/**
 * The one parser set used both by index workers and by the main thread.
 * UpdatePipeline asks this set which files it can parse and skips the rest, so
 * the main thread and the workers must agree exactly — order included, since
 * CompositeParser delegates to the first parser that supports a file
 * (package.json goes to DependencyParser, not JsonConfigParser).
 */
export function createDefaultParser(): CompositeParser {
    return new CompositeParser([
        new TypeScriptParser(),
        new TreeSitterParser(),
        new DependencyParser(),
        new YamlParser(),
        new MarkdownParser(),
        new JsonConfigParser(),
    ]);
}

/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { CodeParser, DeltaGraph, RawCodeEdge, LanguageProvider } from './types';
import { CodeNode, SymbolType } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { calculateChecksum } from '../utils/checksum';
import { LanguageRegistry } from './language-registry';
import { toCanonical } from '../utils/paths';
import { MetricsCalculator } from './metrics-calculator';

/**
 * Optimized Generic TreeSitterParser that delegates language-specific logic to LanguageProviders.
 */
export class TreeSitterParser implements CodeParser {
    private parser: Parser;
    private registry: LanguageRegistry;

    constructor() {
        this.parser = new Parser();
        this.registry = LanguageRegistry.getInstance();
    }

    public supports(filePath: string): boolean {
        return this.registry.getProvider(filePath) !== undefined;
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const provider = this.registry.getProvider(filePath);
        if (!provider) throw new Error(`Unsupported language for file: ${filePath}`);

        const normalizedFilePath = path.resolve(filePath);
        const canonicalFilePath = toCanonical(normalizedFilePath);
        
        this.parser.setLanguage(provider.getLanguage());

        const sourceCode = fs.readFileSync(normalizedFilePath, 'utf8');
        const tree = this.parser.parse(sourceCode);
        
        let query: Parser.Query;
        try {
            query = new Parser.Query(provider.getLanguage(), provider.getQuery());
        } catch (err: any) {
            throw new Error(`TreeSitterQueryError in ${normalizedFilePath} (${provider.languageName}): ${err.message}`);
        }
        
        const matches = query.matches(tree.rootNode);

        const nodes: CodeNode[] = [];
        const edges: RawCodeEdge[] = [];

        // 1. File Node
        nodes.push({
            qualified_name: canonicalFilePath,
            symbol_type: 'file',
            language: provider.languageName,
            file_path: normalizedFilePath,
            start_line: 1,
            end_line: sourceCode.split('\n').length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            checksum: calculateChecksum(sourceCode),
            loc: sourceCode.split('\n').length
        });

        // 2. Map for context-aware relation extraction
        const nodeToSymbolMap = new Map<number, string>(); 

        // First pass: Extract Definitions
        for (const match of matches) {
            for (const capture of match.captures) {
                if (capture.name.endsWith('.def')) {
                    const node = capture.node;
                    const prefix = capture.name.split('.')[0];
                    const type = provider.mapCaptureToSymbolType(capture.name);
                    
                    // Find name capture within the same match
                    const nameCapture = match.captures.find(c => c.name === `${prefix}.name`);
                    let name = nameCapture?.node.text;
                    
                    if (!name) {
                        const idNode = node.childForFieldName('name') || 
                                       node.children.find(c => c.type.includes('identifier'));
                        name = idNode ? idNode.text : `unknown_${node.type}_${node.startPosition.row}`;
                    }

                    const qname = toCanonical(`${normalizedFilePath}#${name}`);

                    // Metadata Extraction
                    const paramsCapture = match.captures.find(c => c.name === `${prefix}.params`);
                    const returnCapture = match.captures.find(c => c.name === `${prefix}.return`);
                    const modifiersCapture = match.captures.find(c => c.name === `${prefix}.modifiers`);

                    nodes.push({
                        qualified_name: qname,
                        symbol_type: type,
                        language: provider.languageName,
                        file_path: normalizedFilePath,
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1,
                        visibility: 'public',
                        is_generated: false,
                        last_updated_commit: commit,
                        version: version,
                        loc: node.endPosition.row - node.startPosition.row + 1,
                        cyclomatic: MetricsCalculator.calculateCyclomaticComplexity(node, node.text),
                        signature: paramsCapture ? `${name}${paramsCapture.node.text}` : undefined,
                        return_type: returnCapture ? returnCapture.node.text.replace(/^[:\s->]+/, '') : undefined,
                        modifiers: modifiersCapture ? modifiersCapture.node.text.split(/\s+/) : undefined
                    });

                    edges.push({
                        from_qname: canonicalFilePath,
                        to_qname: qname,
                        edge_type: 'defines',
                        dynamic: false
                    });

                    nodeToSymbolMap.set(node.id, qname);
                }
            }
        }

        // Second pass: Extract Relations (Calls, Inheritance, Imports)
        for (const match of matches) {
            for (const capture of match.captures) {
                const cName = capture.name;
                const node = capture.node;

                // Determine context (fromQName) by walking up the AST
                let fromQName = canonicalFilePath;
                let current: Parser.SyntaxNode | null = node.parent;
                while (current) {
                    if (nodeToSymbolMap.has(current.id)) {
                        fromQName = nodeToSymbolMap.get(current.id)!;
                        break;
                    }
                    current = current.parent;
                }

                if (cName.endsWith('.expr')) {
                    // Call expression
                    const prefix = cName.split('.')[0];
                    const nameCapture = match.captures.find(c => c.name === `${prefix}.name`);
                    let targetName = nameCapture?.node.text;
                    
                    if (!targetName) {
                        const funcNode = node.childForFieldName('function') || node.childForFieldName('name') || node;
                        const idNode = funcNode.descendantsOfType('identifier')[0] || funcNode;
                        targetName = idNode.text;
                    }

                    edges.push({
                        from_qname: fromQName,
                        to_qname: targetName,
                        edge_type: 'calls',
                        dynamic: true,
                        call_site_line: node.startPosition.row + 1
                    });
                } else if (cName.includes('relation') || cName.includes('import')) {
                    // Import or OOP Relation
                    if (provider.resolveImport) {
                        provider.resolveImport(node, fromQName, edges, cName);
                    }
                }
            }
        }

        return { nodes, edges };
    }

}

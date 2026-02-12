import Parser from 'tree-sitter';
// @ts-ignore
import TypeScript from 'tree-sitter-typescript';
// @ts-ignore
import Python from 'tree-sitter-python';
// @ts-ignore
import JavaScript from 'tree-sitter-javascript';
import { CodeParser, DeltaGraph } from './types';
import { CodeNode, CodeEdge, SymbolType } from '../types';
import * as fs from 'fs';
import { calculateChecksum } from '../utils/checksum';

/**
 * Advanced TreeSitterParser using Query API for precise multi-language extraction.
 */
export class TreeSitterParser implements CodeParser {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
    }

    public supports(filePath: string): boolean {
        return filePath.endsWith('.ts') || filePath.endsWith('.js') || filePath.endsWith('.py');
    }

    /**
     * Define language-specific queries for symbol extraction.
     */
    private getQuery(extension: string, language: any): Parser.Query {
        const queryStrings: Record<string, string> = {
            py: `
                (function_definition 
                    name: (identifier) @function.name 
                    parameters: (parameters) @function.params
                    return_type: (type)? @function.return) @function.def
                (class_definition name: (identifier) @class.name) @class.def
                (call function: (identifier) @call.name) @call.expr
                (import_statement) @import.stmt
                (import_from_statement) @import.from_stmt
            `,
            ts: `
                (class_declaration 
                    name: (identifier) @class.name
                    (modifiers)? @class.modifiers) @class.def
                (method_definition 
                    name: (property_identifier) @method.name
                    parameters: (formal_parameters) @method.params
                    return_type: (type_annotation)? @method.return
                    (modifiers)? @method.modifiers) @method.def
                (function_declaration 
                    name: (identifier) @function.name
                    parameters: (formal_parameters) @function.params
                    return_type: (type_annotation)? @function.return
                    (modifiers)? @function.modifiers) @function.def
                (call_expression function: (identifier) @call.name) @call.expr
                (import_statement source: (string) @import.name)
            `,
            js: `
                (function_declaration name: (identifier) @function.name) @function.def
                (class_declaration name: (identifier) @class.name) @class.def
                (method_definition name: (property_identifier) @method.name) @method.def
                (call_expression function: (identifier) @call.name) @call.expr
                (import_statement source: (string) @import.name)
            `
        };
        return new Parser.Query(language, queryStrings[extension] || '');
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const extension = filePath.split('.').pop() || '';
        let language;

        if (extension === 'ts') language = TypeScript.typescript;
        else if (extension === 'js') language = JavaScript;
        else if (extension === 'py') language = Python;

        if (!language) throw new Error(`Unsupported language: ${filePath}`);
        this.parser.setLanguage(language as any);

        const sourceCode = fs.readFileSync(filePath, 'utf8');
        const tree = this.parser.parse(sourceCode);
        const query = this.getQuery(extension, language);
        const matches = query.matches(tree.rootNode);

        const nodes: CodeNode[] = [];
        const edges: CodeEdge[] = [];

        // 1. File Node
        nodes.push({
            qualified_name: filePath,
            symbol_type: 'file',
            language: extension === 'py' ? 'python' : 'typescript',
            file_path: filePath,
            start_line: 1,
            end_line: sourceCode.split('\n').length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            checksum: calculateChecksum(sourceCode),
            loc: sourceCode.split('\n').length
        });

        // 2. Extract Symbols and Calls using Matches
        const rangeToSymbolMap = new Map<string, string>(); 

        // First pass: Definitions
        for (const match of matches) {
            const captures = match.captures;
            const defCapture = captures.find(c => c.name.endsWith('.def'));
            const nameCapture = captures.find(c => c.name.endsWith('.name'));

            if (defCapture && nameCapture && !captures.some(c => c.name.startsWith('call')) && !captures.some(c => c.name.startsWith('import'))) {
                const node = defCapture.node;
                const name = nameCapture.node.text;
                const type = this.c_to_symbol_type(defCapture.name);
                const qname = `${filePath}#${name}`;

                // Extract Metadata
                const paramsCapture = captures.find(c => c.name.endsWith('.params'));
                const returnCapture = captures.find(c => c.name.endsWith('.return'));
                const modifiersCapture = captures.find(c => c.name.endsWith('.modifiers'));

                const signature = paramsCapture ? `${name}${paramsCapture.node.text}` : undefined;
                const returnType = returnCapture ? returnCapture.node.text.replace(/^[:\s->]+/, '') : undefined;
                const modifiers = modifiersCapture ? modifiersCapture.node.text.split(/\s+/) : undefined;

                nodes.push({
                    qualified_name: qname,
                    symbol_type: type,
                    language: extension === 'py' ? 'python' : 'typescript',
                    file_path: filePath,
                    start_line: node.startPosition.row + 1,
                    end_line: node.endPosition.row + 1,
                    visibility: 'public',
                    is_generated: false,
                    last_updated_commit: commit,
                    version: version,
                    loc: node.endPosition.row - node.startPosition.row + 1,
                    cyclomatic: this.calculateCC(node),
                    signature,
                    return_type: returnType,
                    modifiers
                });

                edges.push({
                    from_qname: filePath,
                    to_qname: qname,
                    edge_type: 'defines',
                    dynamic: false
                } as any);

                const rangeKey = `${node.startPosition.row + 1}-${node.endPosition.row + 1}`;
                rangeToSymbolMap.set(rangeKey, qname);
            }
        }

        // Second pass: Calls & Imports
        for (const match of matches) {
            const captures = match.captures;
            const callCapture = captures.find(c => c.name.endsWith('.expr'));
            const importCapture = captures.find(c => c.name.startsWith('import'));
            const nameCapture = captures.find(c => c.name.endsWith('.name'));

            if (callCapture && nameCapture && captures.some(c => c.name.startsWith('call'))) {
                const node = callCapture.node;
                const targetName = nameCapture.node.text;
                const callLine = node.startPosition.row + 1;

                // Find enclosing symbol (context)
                let fromQName = filePath; // Default to file level
                let minRange = Number.MAX_SAFE_INTEGER;

                for (const [range, qname] of rangeToSymbolMap) {
                    const [start, end] = range.split('-').map(Number);
                    if (callLine >= start && callLine <= end) { // Inside function body (inclusive)
                        const len = end - start;
                        if (len < minRange) { // Get tightest scope
                            minRange = len;
                            fromQName = qname;
                        }
                    }
                }
                edges.push({
                    from_qname: fromQName,
                    to_qname: targetName, // Just simple name, needs heuristic resolution
                    edge_type: 'calls',
                    dynamic: true, // Dynamic because we don't have type checker
                    call_site_line: callLine,
                    target_file_hint: undefined
                } as any);
            } else if (importCapture && !captures.some(c => c.name.startsWith('call'))) {
                // Handle Imports (Task 4 & 7)
                if (extension === 'py') {
                    this.resolvePythonImport(importCapture.node, filePath, edges);
                } else if (nameCapture) {
                    let pkgName = nameCapture.node.text;
                    
                    // Cleanup JS/TS string literals (e.g. 'express' -> express)
                    if ((extension === 'ts' || extension === 'js') && (pkgName.startsWith("'") || pkgName.startsWith('"'))) {
                        pkgName = pkgName.substring(1, pkgName.length - 1);
                    }

                    // Skip relative imports
                    if (!pkgName.startsWith('.')) {
                        const prefix = extension === 'py' ? 'pypi' : 'package';
                        const pkgNodeQName = `${prefix}:${pkgName.split('.')[0]}`; // Just the base package

                        edges.push({
                            from_qname: filePath,
                            to_qname: pkgNodeQName,
                            edge_type: 'depends_on',
                            dynamic: false
                        } as any);
                    }
                }
            }
        }

        return { nodes, edges };
    }

    private resolvePythonImport(node: Parser.SyntaxNode, filePath: string, edges: CodeEdge[]) {
        if (node.type === 'import_statement') {
            // import os, sys as system
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i)!;
                if (child.type === 'aliased_import') {
                    const nameNode = child.childForFieldName('name');
                    if (nameNode) {
                        const pkgName = nameNode.text.split('.')[0];
                        edges.push({ from_qname: filePath, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false } as any);
                    }
                } else if (child.type === 'dotted_name') {
                    // import requests
                    const pkgName = child.text.split('.')[0];
                    edges.push({ from_qname: filePath, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false } as any);
                }
            }
        } else if (node.type === 'import_from_statement') {
            // from math import sqrt
            const moduleNode = node.childForFieldName('module_name');
            if (moduleNode) {
                const pkgName = moduleNode.text.split('.')[0];
                let isRelative = false;
                for (let i = 0; i < node.childCount; i++) {
                    if (node.child(i)!.type === 'relative_import' || node.child(i)!.text.startsWith('.')) {
                        isRelative = true;
                        break;
                    }
                }

                if (!isRelative) {
                    edges.push({ from_qname: filePath, to_qname: `pypi:${pkgName}`, edge_type: 'depends_on', dynamic: false } as any);
                }
            }
        }
    }

    /**
     * Language-agnostic Cyclomatic Complexity using Tree-sitter nodes.
     */
    private calculateCC(node: Parser.SyntaxNode): number {
        let complexity = 1;
        const decisionPoints = [
            'if_statement', 'for_statement', 'while_statement', 'case_clause',
            'catch_clause', 'conditional_expression', 'binary_expression',
            'for_in_statement', 'if_expression'
        ];

        const walk = (n: Parser.SyntaxNode) => {
            if (decisionPoints.includes(n.type)) {
                if (n.type === 'binary_expression') {
                    const text = n.text;
                    if (text.includes('&&') || text.includes('||') || text.includes('and') || text.includes('or')) complexity++;
                } else {
                    complexity++;
                }
            }
            for (let i = 0; i < n.childCount; i++) {
                walk(n.child(i)!);
            }
        };

        walk(node);
        return complexity;
    }

    private c_to_symbol_type(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('method')) return 'method';
        return 'field';
    }
}
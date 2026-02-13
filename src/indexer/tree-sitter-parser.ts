import Parser from 'tree-sitter';
import { CodeParser, DeltaGraph, RawCodeEdge, LanguageProvider } from './types';
import { CodeNode, SymbolType } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { calculateChecksum } from '../utils/checksum';
import { LanguageRegistry } from './language-registry';

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

        // Ensure fully qualified path with drive letter and real case
        let normalizedFilePath = path.resolve(filePath);
        if (fs.existsSync(normalizedFilePath)) {
            normalizedFilePath = fs.realpathSync(normalizedFilePath);
        }
        
        this.parser.setLanguage(provider.getLanguage());

        const sourceCode = fs.readFileSync(normalizedFilePath, 'utf8');
        const tree = this.parser.parse(sourceCode);
        
        let query: Parser.Query;
        try {
            query = new Parser.Query(provider.getLanguage(), provider.getQuery());
        } catch (err: any) {
            throw new Error(`TreeSitterQueryError in ${normalizedFilePath} (${provider.languageName}): ${err.message}\nQuery: ${provider.getQuery()}`);
        }
        
        const matches = query.matches(tree.rootNode);

        const nodes: CodeNode[] = [];
        const edges: RawCodeEdge[] = [];

        // 1. File Node
        nodes.push({
            qualified_name: normalizedFilePath,
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

        // 2. Extract Symbols and Relations
        const nodeToSymbolMap = new Map<number, string>(); 
        
        // First pass: Definitions
        for (const match of matches) {
            const captures = match.captures;
            const defCaptures = captures.filter(c => c.name.endsWith('.def'));

            for (const defCapture of defCaptures) {
                const node = defCapture.node;
                const type = provider.mapCaptureToSymbolType(defCapture.name);
                
                const prefix = defCapture.name.split('.')[0];
                const nameCapture = captures.find(c => c.name === `${prefix}.name`);
                
                let name = nameCapture?.node.text;
                if (!name) {
                    const idNode = node.childForFieldName('name') || 
                                   node.children.find(c => c.type === 'identifier' || c.type === 'type_identifier' || c.type === 'field_identifier' || c.type === 'simple_identifier');
                    name = idNode ? idNode.text : `unknown_${node.type}_${node.startPosition.row}`;
                }

                const qname = `${normalizedFilePath}#${name}`;

                const paramsCapture = captures.find(c => c.name === `${prefix}.params`);
                const returnCapture = captures.find(c => c.name === `${prefix}.return`);
                const modifiersCapture = captures.find(c => c.name === `${prefix}.modifiers`);

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
                    cyclomatic: this.calculateCC(node, provider),
                    signature: paramsCapture ? `${name}${paramsCapture.node.text}` : undefined,
                    return_type: returnCapture ? returnCapture.node.text.replace(/^[:\s->]+/, '') : undefined,
                    modifiers: modifiersCapture ? modifiersCapture.node.text.split(/\s+/)
 : undefined
                });

                edges.push({
                    from_qname: normalizedFilePath,
                    to_qname: qname,
                    edge_type: 'defines',
                    dynamic: false
                });

                // Map this node to this symbol
                nodeToSymbolMap.set(node.id, qname);
            }
        }

        // Second pass: Relations (Calls, Imports, Inheritance, etc.)
        for (const match of matches) {
            const captures = match.captures;
            const callCapture = captures.find(c => c.name.endsWith('.expr'));
            const relationCapture = captures.find(c => c.name.includes('.import') || c.name.includes('.relation'));
            const nameCapture = captures.find(c => c.name.endsWith('.name'));

            if (callCapture && captures.some(c => c.name.startsWith('call'))) {
                const node = callCapture.node;
                let targetName = nameCapture?.node.text;
                if (!targetName) {
                    const funcNode = node.childForFieldName('function') || node.childForFieldName('name') || node;
                    const idNode = funcNode.descendantsOfType('identifier')[0] || 
                                   funcNode.descendantsOfType('field_identifier')[0] ||
                                   funcNode.descendantsOfType('simple_identifier')[0] ||
                                   funcNode;
                    targetName = idNode.text;
                }

                const callLine = node.startPosition.row + 1;
                let fromQName = normalizedFilePath;
                let current: Parser.SyntaxNode | null = node.parent;
                while (current) {
                    if (nodeToSymbolMap.has(current.id)) {
                        fromQName = nodeToSymbolMap.get(current.id)!;
                        break;
                    }
                    current = current.parent;
                }

                edges.push({
                    from_qname: fromQName,
                    to_qname: targetName,
                    edge_type: 'calls',
                    dynamic: true,
                    call_site_line: callLine
                });
            }
            
            if (relationCapture && provider.resolveImport) {
                const node = relationCapture.node;
                let fromQName = normalizedFilePath;
                let current: Parser.SyntaxNode | null = node.parent;
                
                while (current) {
                    if (nodeToSymbolMap.has(current.id)) {
                        fromQName = nodeToSymbolMap.get(current.id)!;
                        break;
                    }
                    current = current.parent;
                }

                provider.resolveImport(node, fromQName, edges, relationCapture.name);
            }
        }

        return { nodes, edges };
    }

    private calculateCC(node: Parser.SyntaxNode, provider: LanguageProvider): number {
        let complexity = 1;
        const decisionPoints = provider.getDecisionPoints();
        const walk = (n: Parser.SyntaxNode) => {
            if (decisionPoints.includes(n.type)) {
                if (n.type === 'binary_expression') {
                    const text = n.text;
                    if (text.includes('&&') || text.includes('||') || text.includes('and') || text.includes('or')) complexity++;
                } else complexity++;
            }
            for (let i = 0; i < n.childCount; i++) walk(n.child(i)!);
        };
        walk(node);
        return complexity;
    }
}
